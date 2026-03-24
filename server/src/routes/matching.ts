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
}

interface GLRow {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: string;
  source: string;
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

// POST /api/matching/run - run auto-match algorithm
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

    // Match bank transactions to GL transactions
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
        });
      }
    }

    // Insert all matches into DB
    for (const m of matches) {
      await client.query(
        `INSERT INTO matched_transactions
         (id, date, bank_desc, gl_desc, amount, currency, bank_name, match_type, confidence, status, approval_stage, flags, bank_tx_id, gl_tx_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [m.id, m.date, m.bank_desc, m.gl_desc, m.amount, m.currency, m.bank_name, m.match_type, m.confidence, m.status, m.approval_stage, m.flags, m.bank_tx_id, m.gl_tx_id]
      );
    }

    await client.query('COMMIT');

    const matched = matches.filter(m => m.status === 'matched' || m.status === 'pending').length;
    const unmatched = matches.filter(m => m.status === 'unmatched').length;

    res.json({
      total: matches.length,
      matched,
      unmatched,
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

export default router;
