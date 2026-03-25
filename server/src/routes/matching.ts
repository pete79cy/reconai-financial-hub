import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';
import {
  calculateConfidence,
  CONFIDENCE_AUTO_MATCH_MIN,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  HIGH_VALUE_THRESHOLD,
} from '../utils/reconciliation';

const router = Router();

interface BankRow {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: string;
  bank_name: string;
  transaction_type: string | null;
  reference_number: string | null;
  value_date: string | null;
  balance: string | null;
  branch_code: string | null;
}

interface GLRow {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: string;
  source: string;
  sequence: string | null;
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

/**
 * Extract a reference/cheque number from a GL description.
 * GL descriptions look like "HOUSE & GARDEN - 59271995"
 * We extract the number after the last " - "
 */
function extractGLChequeNumber(description: string): string | null {
  const parts = description.split(' - ');
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    // Check if it looks like a number (digits, possibly with spaces)
    const cleaned = last.replace(/\s/g, '');
    if (/^\d+$/.test(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Check if a GL description contains a given reference number
 */
function glDescriptionContainsRef(glDesc: string, refNumber: string): boolean {
  if (!refNumber || !glDesc) return false;
  const cleaned = refNumber.replace(/\s/g, '');
  return glDesc.replace(/\s/g, '').includes(cleaned);
}

/**
 * Derive the current period (YYYY-MM) from bank_metadata period_to date.
 */
function derivePeriodFromDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Compute the previous period string (YYYY-MM).
 */
function getPreviousPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

// POST /api/matching/run - run 3-pass auto-match algorithm
router.post('/run', async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear previous matches
    await client.query('DELETE FROM matched_transactions');

    // Fetch all bank and GL transactions
    const bankResult = await client.query('SELECT * FROM bank_transactions ORDER BY date, id');
    const glResult = await client.query('SELECT * FROM gl_transactions ORDER BY date, id');

    const bankTxs: BankRow[] = bankResult.rows;
    const glTxs: GLRow[] = glResult.rows;

    // Get current rules
    const rulesResult = await client.query('SELECT * FROM rules WHERE id = 1');
    const rules = rulesResult.rows[0] || { weekend_alert: true, high_value: true };

    const usedBankIds = new Set<string>();
    const usedGLIds = new Set<string>();
    const matches: any[] = [];

    // ============================================================
    // PASS 1: Cheques (exact match by reference number)
    // ============================================================
    const chequeBankTxs = bankTxs.filter(bt =>
      bt.transaction_type &&
      (bt.transaction_type.toLowerCase().includes('cheque') ||
       bt.transaction_type.toLowerCase().includes('check'))
    );

    const paymentGLTxs = glTxs.filter(gl =>
      gl.source && gl.source.toLowerCase().includes('payment')
    );

    for (const bankTx of chequeBankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;
      if (!bankTx.reference_number) continue;

      const bankRef = bankTx.reference_number.replace(/\s/g, '');
      let bestMatch: GLRow | null = null;
      let bestConfidence = 0;

      for (const glTx of paymentGLTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        const glChequeNum = extractGLChequeNumber(glTx.description);
        const refMatchByChequeNum = glChequeNum && glChequeNum === bankRef;
        const refMatchByContains = glDescriptionContainsRef(glTx.description, bankRef);

        if (refMatchByChequeNum || refMatchByContains) {
          const bankAmount = parseFloat(bankTx.amount);
          const glAmount = parseFloat(glTx.amount);
          const amountDiff = Math.abs(bankAmount - glAmount);

          let confidence: number;
          if (amountDiff < 0.01) {
            confidence = 100;
          } else {
            confidence = 90;
          }

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = glTx;
          }
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const amount = parseFloat(bankTx.amount);
        const flags: string[] = [];
        if (rules.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: bestConfidence,
          status: 'matched',
          approval_stage: 'none',
          flags,
          bank_tx_id: bankTx.id,
          gl_tx_id: bestMatch.id,
          match_category: 'cheque',
        });
      }
    }

    // ============================================================
    // PASS 2: Deposits (match by amount + date)
    // ============================================================
    const depositBankTxs = bankTxs.filter(bt => {
      if (usedBankIds.has(bt.id)) return false;
      if (bt.type !== 'credit') return false;
      const tt = (bt.transaction_type || '').toLowerCase();
      return tt.includes('deposit') || tt.includes('jcc') || tt.includes('credit') || tt.includes('transfer');
    });

    const depositGLTxs = glTxs.filter(gl => {
      if (usedGLIds.has(gl.id)) return false;
      if (gl.type !== 'debit') return false;
      const src = (gl.source || '').toLowerCase();
      return src.includes('deposit') || src.includes('receipt');
    });

    for (const bankTx of depositBankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;

      const bankAmount = parseFloat(bankTx.amount);
      const bankDate = new Date(bankTx.date);
      let bestMatch: GLRow | null = null;
      let bestConfidence = 0;

      for (const glTx of depositGLTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        const glAmount = parseFloat(glTx.amount);
        const amountDiff = Math.abs(bankAmount - glAmount);

        // Must be exact amount match
        if (amountDiff >= 0.01) continue;

        const glDate = new Date(glTx.date);
        const daysDiff = Math.abs((bankDate.getTime() - glDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff > 5) continue;

        let confidence: number;
        if (daysDiff < 1) {
          confidence = 98;
        } else if (daysDiff <= 1) {
          confidence = 90;
        } else if (daysDiff <= 3) {
          confidence = 80;
        } else {
          confidence = 70;
        }

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = glTx;
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const amount = bankAmount;
        const flags: string[] = [];
        if (rules.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: bestConfidence,
          status: 'matched',
          approval_stage: 'none',
          flags,
          bank_tx_id: bankTx.id,
          gl_tx_id: bestMatch.id,
          match_category: 'deposit',
        });
      }
    }

    // ============================================================
    // PASS 3: Fuzzy match (all remaining unmatched)
    // ============================================================
    for (const bankTx of bankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;

      let bestMatch: GLRow | null = null;
      let bestConfidence = 0;

      for (const glTx of glTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        // Bank and GL types are mirrored in reconciliation:
        // Bank debit (money out) = GL credit (decrease in asset)
        // Bank credit (money in) = GL debit (increase in asset)
        if (bankTx.type === glTx.type) continue;

        const confidence = calculateConfidence(
          parseFloat(bankTx.amount),
          parseFloat(glTx.amount),
          bankTx.description,
          glTx.description
        );

        if (confidence > bestConfidence && confidence >= CONFIDENCE_AUTO_MATCH_MIN) {
          bestConfidence = confidence;
          bestMatch = glTx;
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const amount = parseFloat(bankTx.amount);
        const flags: string[] = [];
        if (rules.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: bestConfidence >= CONFIDENCE_HIGH ? '1:1' : 'Manual',
          confidence: bestConfidence,
          status: bestConfidence >= CONFIDENCE_MEDIUM ? 'matched' : 'pending',
          approval_stage: 'none',
          flags,
          bank_tx_id: bankTx.id,
          gl_tx_id: bestMatch.id,
          match_category: 'other',
        });
      }
    }

    // Add unmatched bank transactions
    for (const bankTx of bankTxs) {
      if (!usedBankIds.has(bankTx.id)) {
        const amount = parseFloat(bankTx.amount);
        const flags: string[] = [];
        if (rules.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('UNMATCHED-BANK'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: '',
          amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: 'Manual',
          confidence: 0,
          status: 'unmatched',
          approval_stage: 'none',
          flags,
          bank_tx_id: bankTx.id,
          gl_tx_id: null,
          match_category: null,
        });
      }
    }

    // Add unmatched GL transactions
    for (const glTx of glTxs) {
      if (!usedGLIds.has(glTx.id)) {
        const amount = parseFloat(glTx.amount);
        const flags: string[] = [];
        if (rules.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(glTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('UNMATCHED-GL'),
          date: glTx.date,
          bank_desc: '',
          gl_desc: glTx.description,
          amount,
          currency: 'EUR',
          bank_name: 'BOC',
          match_type: 'Manual',
          confidence: 0,
          status: 'unmatched',
          approval_stage: 'none',
          flags,
          bank_tx_id: null,
          gl_tx_id: glTx.id,
          match_category: null,
        });
      }
    }

    // Insert all matches into DB
    for (const m of matches) {
      await client.query(
        `INSERT INTO matched_transactions
         (id, date, bank_desc, gl_desc, amount, currency, bank_name, match_type, confidence, status, approval_stage, flags, bank_tx_id, gl_tx_id, match_category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [m.id, m.date, m.bank_desc, m.gl_desc, m.amount, m.currency, m.bank_name, m.match_type, m.confidence, m.status, m.approval_stage, m.flags, m.bank_tx_id, m.gl_tx_id, m.match_category || null]
      );
    }

    // ============================================================
    // Outstanding check carry-forward logic
    // ============================================================
    // Derive current period from bank_metadata period_to date
    const metadataResult = await client.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];
    const currentPeriod = metadata ? derivePeriodFromDate(metadata.period_to) : null;

    if (currentPeriod) {
      const prevPeriod = getPreviousPeriod(currentPeriod);

      // Get outstanding items from previous period that are still outstanding
      const prevOutstanding = await client.query(
        `SELECT * FROM outstanding_items WHERE period = $1 AND status = 'outstanding'`,
        [prevPeriod]
      );

      // Build a set of reference numbers that appeared in the current bank statement (cheques)
      const bankRefSet = new Set<string>();
      for (const bt of bankTxs) {
        if (bt.reference_number) {
          bankRefSet.add(bt.reference_number.replace(/\s/g, ''));
        }
      }

      // Check each outstanding cheque from previous period
      for (const item of prevOutstanding.rows) {
        if (item.item_type === 'cheque' && item.reference_number) {
          const ref = item.reference_number.replace(/\s/g, '');
          if (bankRefSet.has(ref)) {
            // This cheque cleared in the current bank statement
            await client.query(
              `UPDATE outstanding_items
               SET status = 'cleared', cleared_in_period = $2, cleared_date = CURRENT_DATE
               WHERE id = $1`,
              [item.id, currentPeriod]
            );
          }
        }
      }

      // Ensure current period exists in reconciliation_periods
      await client.query(
        `INSERT INTO reconciliation_periods (id, status) VALUES ($1, 'open')
         ON CONFLICT (id) DO NOTHING`,
        [currentPeriod]
      );

      // For new unmatched GL cheques from the current run, add them to outstanding_items
      // (only if they don't already exist in outstanding_items for this period)
      const unmatchedGLCheques = glTxs.filter(gl => {
        if (usedGLIds.has(gl.id)) return false;
        const src = (gl.source || '').toLowerCase();
        return src.includes('payment') || src.includes('cheque') || src.includes('check');
      });

      for (const glTx of unmatchedGLCheques) {
        // Check if already tracked in outstanding_items for this period
        const existing = await client.query(
          `SELECT id FROM outstanding_items WHERE period = $1 AND gl_tx_id = $2`,
          [currentPeriod, glTx.id]
        );
        if (existing.rows.length === 0) {
          const glRef = extractGLChequeNumber(glTx.description);
          await client.query(
            `INSERT INTO outstanding_items
             (id, period, item_type, reference_number, description, amount, date, source, gl_tx_id, source_period, status)
             VALUES ($1, $2, 'cheque', $3, $4, $5, $6, $7, $8, $9, 'outstanding')`,
            [
              generateId('OI'),
              currentPeriod,
              glRef,
              glTx.description,
              parseFloat(glTx.amount),
              glTx.date,
              glTx.source,
              glTx.id,
              currentPeriod,
            ]
          );
        }
      }

      // Also add new unmatched GL deposits to outstanding_items
      const unmatchedGLDeposits = glTxs.filter(gl => {
        if (usedGLIds.has(gl.id)) return false;
        if (gl.type !== 'debit') return false;
        const src = (gl.source || '').toLowerCase();
        return src.includes('deposit') || src.includes('receipt');
      });

      for (const glTx of unmatchedGLDeposits) {
        const existing = await client.query(
          `SELECT id FROM outstanding_items WHERE period = $1 AND gl_tx_id = $2`,
          [currentPeriod, glTx.id]
        );
        if (existing.rows.length === 0) {
          await client.query(
            `INSERT INTO outstanding_items
             (id, period, item_type, reference_number, description, amount, date, source, gl_tx_id, source_period, status)
             VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7, $8, $9, 'outstanding')`,
            [
              generateId('OI'),
              currentPeriod,
              null,
              glTx.description,
              parseFloat(glTx.amount),
              glTx.date,
              glTx.source,
              glTx.id,
              currentPeriod,
            ]
          );
        }
      }
    }

    await client.query('COMMIT');

    const matched = matches.filter(m => m.status === 'matched' || m.status === 'pending').length;
    const unmatched = matches.filter(m => m.status === 'unmatched').length;

    res.json({
      total: matches.length,
      matched,
      unmatched,
      currentPeriod: currentPeriod || null,
      transactions: matches,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error running auto-match:', err);
    res.status(500).json({ error: 'Failed to run auto-match' });
  } finally {
    client.release();
  }
});

// GET /api/matching/unmatched-bank - get unmatched bank transactions with optional search
router.get('/unmatched-bank', async (req: Request, res: Response) => {
  const search = (req.query.q as string) || '';
  try {
    let query = `
      SELECT bt.* FROM bank_transactions bt
      WHERE bt.id NOT IN (
        SELECT bank_tx_id FROM matched_transactions
        WHERE bank_tx_id IS NOT NULL AND status IN ('matched', 'approved')
      )
    `;
    const params: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (bt.description ILIKE $1 OR bt.reference_number ILIKE $1 OR CAST(bt.amount AS TEXT) LIKE $1)`;
    }

    query += ' ORDER BY bt.date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching unmatched bank:', err);
    res.status(500).json({ error: 'Failed to fetch unmatched bank transactions' });
  }
});

// GET /api/matching/unmatched-gl - get unmatched GL transactions with optional search
router.get('/unmatched-gl', async (req: Request, res: Response) => {
  const search = (req.query.q as string) || '';
  try {
    let query = `
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.id NOT IN (
        SELECT gl_tx_id FROM matched_transactions
        WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
      )
    `;
    const params: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (gl.description ILIKE $1 OR gl.reference ILIKE $1 OR CAST(gl.amount AS TEXT) LIKE $1)`;
    }

    query += ' ORDER BY gl.date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching unmatched GL:', err);
    res.status(500).json({ error: 'Failed to fetch unmatched GL transactions' });
  }
});

// POST /api/matching/manual - manually match a bank tx with a GL tx
router.post('/manual', async (req: Request, res: Response) => {
  const { bank_tx_id, gl_tx_id } = req.body;

  if (!bank_tx_id || !gl_tx_id) {
    return res.status(400).json({ error: 'bank_tx_id and gl_tx_id are required' });
  }

  try {
    // Remove any existing pending/rejected matches for these transactions
    await pool.query(
      `DELETE FROM matched_transactions
       WHERE (bank_tx_id = $1 OR gl_tx_id = $2) AND status IN ('pending', 'rejected', 'unmatched')`,
      [bank_tx_id, gl_tx_id]
    );

    // Fetch both transactions
    const bankResult = await pool.query('SELECT * FROM bank_transactions WHERE id = $1', [bank_tx_id]);
    const glResult = await pool.query('SELECT * FROM gl_transactions WHERE id = $1', [gl_tx_id]);

    if (bankResult.rows.length === 0) return res.status(404).json({ error: 'Bank transaction not found' });
    if (glResult.rows.length === 0) return res.status(404).json({ error: 'GL transaction not found' });

    const bankTx = bankResult.rows[0];
    const glTx = glResult.rows[0];

    const bankAmt = Math.abs(parseFloat(bankTx.amount));
    const glAmt = Math.abs(parseFloat(glTx.amount));

    // Calculate confidence for display (even though manual)
    const confidence = calculateConfidence(bankAmt, glAmt, bankTx.description, glTx.description);

    // Determine category
    let category = 'other';
    const glDesc = (glTx.description || '').toLowerCase();
    const glSource = (glTx.source || '').toLowerCase();
    if (glSource.includes('payment') || glSource.includes('cheque') || glSource.includes('check') ||
        glDesc.includes('cheque') || glDesc.includes('check')) {
      category = 'cheque';
    } else if (bankTx.type === 'credit' || glTx.type === 'debit') {
      category = 'deposit';
    }

    const flags: string[] = [];
    if (bankAmt >= HIGH_VALUE_THRESHOLD) flags.push('High Value');
    if (Math.abs(bankAmt - glAmt) > 0.01) flags.push('Amount Mismatch');

    const id = generateId('MATCH');
    const result = await pool.query(
      `INSERT INTO matched_transactions
       (id, bank_tx_id, gl_tx_id, bank_desc, gl_desc, amount, bank_amount, gl_amount,
        date, bank_name, confidence, match_type, status, category, flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', 'pending', $12, $13)
       RETURNING *`,
      [
        id,
        bank_tx_id,
        gl_tx_id,
        bankTx.description,
        glTx.description,
        bankAmt,
        bankAmt,
        glAmt,
        bankTx.date,
        bankTx.bank_name || 'BOC',
        Math.round(confidence),
        category,
        JSON.stringify(flags),
      ]
    );

    res.json(result.rows[0]);
  } catch (err: any) {
    // Handle duplicate match (unique constraint on bank_tx_id or gl_tx_id)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'One of these transactions is already matched' });
    }
    console.error('Error creating manual match:', err);
    res.status(500).json({ error: 'Failed to create manual match' });
  }
});

export default router;
