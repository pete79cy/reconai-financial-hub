import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';
import {
  calculateConfidence,
  CONFIDENCE_AUTO_MATCH_MIN,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  HIGH_VALUE_THRESHOLD,
  extractPattern,
  matchesPattern,
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

// ============================================================
// Helper: create or update a learned matching rule
// ============================================================
async function createLearnedRule(
  ruleType: 'include' | 'exclude',
  bankDesc: string,
  bankTxType: string | null,
  glDesc: string,
  glSource: string | null,
  confidenceBoost: number,
  createdFrom: string
) {
  const bankPattern = extractPattern(bankDesc);
  const glPattern = extractPattern(glDesc);

  // Skip if patterns are too short to be meaningful
  if (bankPattern.length < 3 && glPattern.length < 3) return;

  // Check for duplicate: same type + same bank_tx_type + similar patterns
  const existing = await pool.query(
    `SELECT id, times_applied FROM matching_rules
     WHERE rule_type = $1
       AND COALESCE(bank_tx_type, '') = COALESCE($2, '')
       AND COALESCE(gl_source, '') = COALESCE($3, '')
       AND bank_pattern = $4
       AND gl_pattern = $5`,
    [ruleType, bankTxType || '', glSource || '', bankPattern, glPattern]
  );

  if (existing.rows.length > 0) {
    // Strengthen existing rule
    await pool.query(
      `UPDATE matching_rules SET times_applied = times_applied + 1 WHERE id = $1`,
      [existing.rows[0].id]
    );
  } else {
    const id = generateId('RULE');
    await pool.query(
      `INSERT INTO matching_rules
       (id, rule_type, bank_pattern, bank_tx_type, gl_pattern, gl_source,
        confidence_boost, created_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, ruleType, bankPattern, bankTxType || null, glPattern, glSource || null,
       confidenceBoost, createdFrom]
    );
  }
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
    const clearedOutstandingIds: string[] = [];

    // ============================================================
    // PASS 0: Presented cheques → check against outstanding items
    // Bank cheques should be matched against outstanding cheques from
    // previous months. If found, mark outstanding as cleared and mark
    // the bank tx as used (it's already reconciled from a prior month).
    // ============================================================
    // Only true presented cheques — exclude "Deposit - Cash/Cheque" which is a deposit
    const chequeBankTxs = bankTxs.filter(bt => {
      if (!bt.transaction_type) return false;
      const tt = bt.transaction_type.toLowerCase();
      // Must be a cheque type but NOT a deposit containing "cheque"
      if (tt.includes('deposit')) return false;
      return tt.includes('cheque') || tt.includes('check');
    });

    // Get ALL outstanding cheques from all periods
    const outstandingResult = await client.query(
      `SELECT * FROM outstanding_items WHERE status = 'outstanding' AND item_type = 'cheque'`
    );
    const outstandingCheques = outstandingResult.rows;

    for (const bankTx of chequeBankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;
      if (!bankTx.reference_number) continue;

      const bankRef = bankTx.reference_number.replace(/\s/g, '');

      // Check if this cheque was outstanding from a previous period
      const matchingOutstanding = outstandingCheques.find(oi => {
        if (!oi.reference_number) return false;
        return oi.reference_number.replace(/\s/g, '') === bankRef;
      });

      if (matchingOutstanding) {
        // This cheque was outstanding and has now cleared in the bank
        usedBankIds.add(bankTx.id);
        clearedOutstandingIds.push(matchingOutstanding.id);

        // Mark the outstanding item as cleared
        await client.query(
          `UPDATE outstanding_items
           SET status = 'cleared', cleared_date = CURRENT_DATE
           WHERE id = $1`,
          [matchingOutstanding.id]
        );

        // Create a match record for tracking (already reconciled)
        const bankAmount = parseFloat(bankTx.amount);
        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: `[Cleared Outstanding] ${matchingOutstanding.description}`,
          amount: bankAmount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: 100,
          status: 'matched',
          approval_stage: 'none',
          flags: [],
          bank_tx_id: bankTx.id,
          gl_tx_id: matchingOutstanding.gl_tx_id || null,
          match_category: 'cheque',
        });
      }
    }

    // ============================================================
    // PASS 1: Remaining cheques → match with current GL by reference
    //   - Amount matches exactly → status: 'matched'
    //   - Cheque number matches but amount differs → status: 'pending'
    // ============================================================
    const paymentGLTxs = glTxs.filter(gl =>
      gl.source && gl.source.toLowerCase().includes('payment')
    );

    for (const bankTx of chequeBankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;
      if (!bankTx.reference_number) continue;

      const bankRef = bankTx.reference_number.replace(/\s/g, '');
      let bestMatch: GLRow | null = null;
      let bestAmountDiff = Infinity;

      for (const glTx of paymentGLTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        const glChequeNum = extractGLChequeNumber(glTx.description);
        const refMatchByChequeNum = glChequeNum && glChequeNum === bankRef;
        const refMatchByContains = glDescriptionContainsRef(glTx.description, bankRef);

        if (refMatchByChequeNum || refMatchByContains) {
          const bankAmount = parseFloat(bankTx.amount);
          const glAmount = parseFloat(glTx.amount);
          const amountDiff = Math.abs(bankAmount - glAmount);

          if (amountDiff < bestAmountDiff) {
            bestAmountDiff = amountDiff;
            bestMatch = glTx;
          }
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const bankAmount = parseFloat(bankTx.amount);
        const glAmount = parseFloat(bestMatch.amount);
        const amountDiff = Math.abs(bankAmount - glAmount);
        const amountMatches = amountDiff < 0.01;

        const flags: string[] = [];
        if (rules.high_value && bankAmount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');
        if (!amountMatches) flags.push('Amount Mismatch');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount: bankAmount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: amountMatches ? 100 : 70,
          status: amountMatches ? 'matched' : 'pending',
          approval_stage: 'none',
          flags,
          bank_tx_id: bankTx.id,
          gl_tx_id: bestMatch.id,
          match_category: 'cheque',
        });
      }
    }

    // ============================================================
    // PASS 2: Deposits — exact amount match only → status: 'matched'
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
      let bestDaysDiff = Infinity;

      for (const glTx of depositGLTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        const glAmount = parseFloat(glTx.amount);
        const amountDiff = Math.abs(bankAmount - glAmount);

        // Only exact amount matches
        if (amountDiff >= 0.01) continue;

        const glDate = new Date(glTx.date);
        const daysDiff = Math.abs((bankDate.getTime() - glDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff > 5) continue;

        if (daysDiff < bestDaysDiff) {
          bestDaysDiff = daysDiff;
          bestMatch = glTx;
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const flags: string[] = [];
        if (rules.high_value && bankAmount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount: bankAmount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: 95,
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
    // LEARNED RULES PASS: Apply include rules from manual matches
    // Runs before Pass 3 to give learned patterns priority
    // ============================================================
    const includeRules = await client.query(
      `SELECT * FROM matching_rules WHERE rule_type = 'include' ORDER BY times_applied DESC, priority DESC`
    );

    for (const rule of includeRules.rows) {
      for (const bankTx of bankTxs) {
        if (usedBankIds.has(bankTx.id)) continue;

        // Check if bank tx matches the rule pattern
        const bankTT = (bankTx.transaction_type || '').toLowerCase();
        if (rule.bank_tx_type && bankTT !== rule.bank_tx_type.toLowerCase()) continue;
        if (rule.bank_pattern && !matchesPattern(bankTx.description, rule.bank_pattern)) continue;

        const bankAmount = parseFloat(bankTx.amount);
        let bestMatch: GLRow | null = null;
        let bestConfidence = 0;

        for (const glTx of glTxs) {
          if (usedGLIds.has(glTx.id)) continue;
          if (bankTx.type === glTx.type) continue;

          // Check if GL tx matches the rule pattern
          const glSrc = (glTx.source || '').toLowerCase();
          if (rule.gl_source && glSrc !== rule.gl_source.toLowerCase()) continue;
          if (rule.gl_pattern && !matchesPattern(glTx.description, rule.gl_pattern)) continue;

          const glAmount = parseFloat(glTx.amount);
          if (Math.abs(bankAmount - glAmount) >= 0.01) continue;

          const confidence = calculateConfidence(bankAmount, glAmount, bankTx.description, glTx.description)
            + (rule.confidence_boost || 0);

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestMatch = glTx;
          }
        }

        if (bestMatch && bestConfidence >= CONFIDENCE_AUTO_MATCH_MIN) {
          usedBankIds.add(bankTx.id);
          usedGLIds.add(bestMatch.id);

          const flags: string[] = ['Learned Rule'];
          if (rules.high_value && bankAmount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
          if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

          matches.push({
            id: generateId('MATCH'),
            date: bankTx.date,
            bank_desc: bankTx.description,
            gl_desc: bestMatch.description,
            amount: bankAmount,
            currency: 'EUR',
            bank_name: bankTx.bank_name || 'BOC',
            match_type: '1:1',
            confidence: Math.min(bestConfidence, 100),
            status: 'matched',
            approval_stage: 'none',
            flags,
            bank_tx_id: bankTx.id,
            gl_tx_id: bestMatch.id,
            match_category: 'other',
          });

          // Increment times_applied
          await client.query(
            'UPDATE matching_rules SET times_applied = times_applied + 1 WHERE id = $1',
            [rule.id]
          );
        }
      }
    }

    // ============================================================
    // PASS 3: All remaining — exact amount match only → status: 'matched'
    // IMPORTANT: Do NOT match non-cheque bank transactions with GL
    // payment/cheque entries. GL cheque payments should only clear
    // via cheque reference (Pass 0/1). A bank transfer is not a cheque.
    // ============================================================
    for (const bankTx of bankTxs) {
      if (usedBankIds.has(bankTx.id)) continue;

      const bankAmount = parseFloat(bankTx.amount);
      const bankTT = (bankTx.transaction_type || '').toLowerCase();
      const isBankCheque = (bankTT.includes('cheque') || bankTT.includes('check')) && !bankTT.includes('deposit');
      let bestMatch: GLRow | null = null;
      let bestConfidence = 0;

      for (const glTx of glTxs) {
        if (usedGLIds.has(glTx.id)) continue;

        // Bank and GL types are mirrored in reconciliation
        if (bankTx.type === glTx.type) continue;

        // Prevent matching non-cheque bank items (transfers, fees, etc.)
        // with GL payment/cheque entries. GL cheques must only clear via
        // Pass 0 (outstanding) or Pass 1 (reference match).
        const glSrc = (glTx.source || '').toLowerCase();
        const isGLCheque = glSrc.includes('payment') || glSrc.includes('cheque') || glSrc.includes('check');
        if (isGLCheque && !isBankCheque) continue;

        const glAmount = parseFloat(glTx.amount);
        const amountDiff = Math.abs(bankAmount - glAmount);

        // Only exact amount matches auto-match
        if (amountDiff >= 0.01) continue;

        const confidence = calculateConfidence(
          bankAmount,
          glAmount,
          bankTx.description,
          glTx.description
        );

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestMatch = glTx;
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        const flags: string[] = [];
        if (rules.high_value && bankAmount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
        if (rules.weekend_alert && isWeekend(bankTx.date)) flags.push('Weekend');

        matches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount: bankAmount,
          currency: 'EUR',
          bank_name: bankTx.bank_name || 'BOC',
          match_type: '1:1',
          confidence: bestConfidence,
          status: 'matched',
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

    // ============================================================
    // EXCLUDE FILTER: Demote matches that hit learned exclude rules
    // Rejected pairings from the past should not auto-match again
    // ============================================================
    const excludeRules = await client.query(
      `SELECT * FROM matching_rules WHERE rule_type = 'exclude'`
    );

    if (excludeRules.rows.length > 0) {
      for (const m of matches) {
        if (m.status !== 'matched' && m.status !== 'pending') continue;
        if (!m.bank_desc || !m.gl_desc) continue;

        for (const rule of excludeRules.rows) {
          const bankMatches = !rule.bank_pattern || matchesPattern(m.bank_desc, rule.bank_pattern);
          const glMatches = !rule.gl_pattern || matchesPattern(m.gl_desc, rule.gl_pattern);

          // Both patterns must match for the exclude rule to fire
          if (bankMatches && glMatches) {
            // Also check tx type and source if specified
            let txTypeOk = true;
            let sourceOk = true;
            if (rule.bank_tx_type && m.bank_tx_id) {
              const bankRow = bankTxs.find(bt => bt.id === m.bank_tx_id);
              if (bankRow) {
                txTypeOk = (bankRow.transaction_type || '').toLowerCase() === rule.bank_tx_type.toLowerCase();
              }
            }
            if (rule.gl_source && m.gl_tx_id) {
              const glRow = glTxs.find(gl => gl.id === m.gl_tx_id);
              if (glRow) {
                sourceOk = (glRow.source || '').toLowerCase() === rule.gl_source.toLowerCase();
              }
            }

            if (txTypeOk && sourceOk) {
              m.status = 'pending';
              if (!m.flags.includes('Excluded by Rule')) {
                m.flags.push('Excluded by Rule');
              }
              await client.query(
                'UPDATE matching_rules SET times_applied = times_applied + 1 WHERE id = $1',
                [rule.id]
              );
              break;
            }
          }
        }
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
    // Outstanding items: carry-forward and auto-add unmatched GL cheques
    // ============================================================
    const metadataResult = await client.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];
    const currentPeriod = metadata ? derivePeriodFromDate(metadata.period_to) : null;

    if (currentPeriod) {
      // Ensure current period exists in reconciliation_periods
      await client.query(
        `INSERT INTO reconciliation_periods (id, status) VALUES ($1, 'open')
         ON CONFLICT (id) DO NOTHING`,
        [currentPeriod]
      );

      // Note: Outstanding cheques were already cleared in PASS 0 above.
      // Now auto-add unmatched GL cheques from current period to outstanding.
      const unmatchedGLCheques = glTxs.filter(gl => {
        if (usedGLIds.has(gl.id)) return false;
        const src = (gl.source || '').toLowerCase();
        return src.includes('payment') || src.includes('cheque') || src.includes('check');
      });

      for (const glTx of unmatchedGLCheques) {
        const existing = await client.query(
          `SELECT id FROM outstanding_items WHERE gl_tx_id = $1`,
          [glTx.id]
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

      // Auto-add unmatched GL deposits to outstanding
      const unmatchedGLDeposits = glTxs.filter(gl => {
        if (usedGLIds.has(gl.id)) return false;
        if (gl.type !== 'debit') return false;
        const src = (gl.source || '').toLowerCase();
        return src.includes('deposit') || src.includes('receipt');
      });

      for (const glTx of unmatchedGLDeposits) {
        const existing = await client.query(
          `SELECT id FROM outstanding_items WHERE gl_tx_id = $1`,
          [glTx.id]
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
    const clearedOutstanding = clearedOutstandingIds.length;

    res.json({
      total: matches.length,
      matched,
      unmatched,
      clearedOutstanding,
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
        WHERE bank_tx_id IS NOT NULL AND status IN ('matched', 'approved', 'pending')
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

// GET /api/matching/unmatched-gl - get unmatched GL transactions + outstanding items
router.get('/unmatched-gl', async (req: Request, res: Response) => {
  const search = (req.query.q as string) || '';
  try {
    // 1. Get unmatched GL transactions from current period
    let glQuery = `
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source,
             gl.sequence AS reference, 'gl' AS record_source
      FROM gl_transactions gl
      WHERE gl.id NOT IN (
        SELECT gl_tx_id FROM matched_transactions
        WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved', 'pending')
      )
    `;
    const glParams: string[] = [];

    if (search) {
      glParams.push(`%${search}%`);
      glQuery += ` AND (gl.description ILIKE $1 OR gl.reference ILIKE $1 OR CAST(gl.amount AS TEXT) LIKE $1)`;
    }

    glQuery += ' ORDER BY gl.date DESC';
    const glResult = await pool.query(glQuery, glParams);

    // 2. Get outstanding items (cheques from previous months still outstanding)
    let oiQuery = `
      SELECT oi.id, oi.date, oi.description, oi.amount, 'credit' AS type,
             oi.source, oi.reference_number AS reference,
             'outstanding' AS record_source, oi.period, oi.item_type
      FROM outstanding_items oi
      WHERE oi.status = 'outstanding'
    `;
    const oiParams: string[] = [];

    if (search) {
      oiParams.push(`%${search}%`);
      oiQuery += ` AND (oi.description ILIKE $1 OR oi.reference_number ILIKE $1 OR CAST(oi.amount AS TEXT) LIKE $1)`;
    }

    oiQuery += ' ORDER BY oi.date DESC';
    const oiResult = await pool.query(oiQuery, oiParams);

    // Mark outstanding items so frontend can distinguish them
    const outstandingRows = oiResult.rows.map((row: any) => ({
      ...row,
      description: `[Outstanding ${row.item_type}] ${row.description}`,
      is_outstanding: true,
    }));

    // Combine: GL transactions first, then outstanding items
    const combined = [...glResult.rows, ...outstandingRows];
    res.json(combined);
  } catch (err) {
    console.error('Error fetching unmatched GL:', err);
    res.status(500).json({ error: 'Failed to fetch unmatched GL transactions' });
  }
});

// POST /api/matching/manual - manually match a bank tx with a GL tx or outstanding item
router.post('/manual', async (req: Request, res: Response) => {
  const { bank_tx_id, gl_tx_id } = req.body;

  if (!bank_tx_id || !gl_tx_id) {
    return res.status(400).json({ error: 'bank_tx_id and gl_tx_id are required' });
  }

  try {
    // Check if gl_tx_id is an outstanding item (starts with "OI-")
    const isOutstanding = gl_tx_id.startsWith('OI-');

    // Fetch bank transaction
    const bankResult = await pool.query('SELECT * FROM bank_transactions WHERE id = $1', [bank_tx_id]);
    if (bankResult.rows.length === 0) return res.status(404).json({ error: 'Bank transaction not found' });
    const bankTx = bankResult.rows[0];
    const bankAmt = Math.abs(parseFloat(bankTx.amount));

    let glDesc: string;
    let glAmt: number;
    let glSource: string;
    let category: string;
    let actualGlTxId: string | null = null;

    if (isOutstanding) {
      // Match with outstanding item — clear it
      const oiResult = await pool.query('SELECT * FROM outstanding_items WHERE id = $1', [gl_tx_id]);
      if (oiResult.rows.length === 0) return res.status(404).json({ error: 'Outstanding item not found' });
      const oi = oiResult.rows[0];

      glDesc = `[Cleared Outstanding] ${oi.description}`;
      glAmt = Math.abs(parseFloat(oi.amount));
      glSource = oi.source || '';
      category = oi.item_type === 'deposit' ? 'deposit' : 'cheque';
      actualGlTxId = oi.gl_tx_id || null;

      // Mark outstanding item as cleared
      await pool.query(
        `UPDATE outstanding_items SET status = 'cleared', cleared_date = CURRENT_DATE WHERE id = $1`,
        [gl_tx_id]
      );
    } else {
      // Regular GL transaction match
      const glResult = await pool.query('SELECT * FROM gl_transactions WHERE id = $1', [gl_tx_id]);
      if (glResult.rows.length === 0) return res.status(404).json({ error: 'GL transaction not found' });
      const glTx = glResult.rows[0];

      glDesc = glTx.description;
      glAmt = Math.abs(parseFloat(glTx.amount));
      glSource = (glTx.source || '').toLowerCase();
      actualGlTxId = glTx.id;

      category = 'other';
      const descLower = (glTx.description || '').toLowerCase();
      if (glSource.includes('payment') || glSource.includes('cheque') || glSource.includes('check') ||
          descLower.includes('cheque') || descLower.includes('check')) {
        category = 'cheque';
      } else if (bankTx.type === 'credit' || glTx.type === 'debit') {
        category = 'deposit';
      }
    }

    // Remove any existing matches for both the bank and GL side
    // For bank: only remove non-approved matches
    // For GL: remove ALL non-approved matches (including 'matched' from auto-run)
    await pool.query(
      `DELETE FROM matched_transactions
       WHERE bank_tx_id = $1 AND status IN ('pending', 'rejected', 'unmatched')`,
      [bank_tx_id]
    );
    if (actualGlTxId) {
      await pool.query(
        `DELETE FROM matched_transactions
         WHERE gl_tx_id = $1 AND status IN ('pending', 'rejected', 'unmatched', 'matched')
           AND match_type != 'Manual'`,
        [actualGlTxId]
      );
    }

    const confidence = calculateConfidence(bankAmt, glAmt, bankTx.description, glDesc);

    const flags: string[] = [];
    if (bankAmt >= HIGH_VALUE_THRESHOLD) flags.push('High Value');
    if (Math.abs(bankAmt - glAmt) > 0.01) flags.push('Amount Mismatch');

    const id = generateId('MATCH');
    const matchStatus = isOutstanding ? 'matched' : 'pending';
    const result = await pool.query(
      `INSERT INTO matched_transactions
       (id, bank_tx_id, gl_tx_id, bank_desc, gl_desc, amount,
        date, bank_name, confidence, match_type, status, match_category, flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Manual', $10, $11, $12)
       RETURNING *`,
      [
        id,
        bank_tx_id,
        actualGlTxId,
        bankTx.description,
        glDesc,
        bankAmt,
        bankTx.date,
        bankTx.bank_name || 'BOC',
        Math.round(confidence),
        matchStatus,
        category,
        flags,
      ]
    );

    // Learn from this manual match — create an 'include' rule
    try {
      await createLearnedRule(
        'include',
        bankTx.description,
        bankTx.transaction_type || null,
        glDesc,
        glSource || null,
        20,    // boost confidence by 20 for similar future pairs
        id
      );
    } catch (learnErr) {
      console.error('Failed to create learned rule (non-fatal):', learnErr);
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('Error creating manual match:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: `Transaction already matched: ${err.detail || err.message}` });
    }
    res.status(500).json({ error: `Failed to create manual match: ${err.message || 'Unknown error'}` });
  }
});

export default router;
