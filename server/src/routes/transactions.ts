import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';
import { extractPattern } from '../utils/reconciliation';

const router = Router();

// GET /api/transactions - list all matched transactions with optional search
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM matched_transactions';
    const params: string[] = [];

    if (search && typeof search === 'string' && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      query += ` WHERE LOWER(id) LIKE $1
                 OR LOWER(bank_desc) LIKE $1
                 OR LOWER(gl_desc) LIKE $1
                 OR LOWER(bank_name) LIKE $1
                 OR LOWER(status) LIKE $1
                 OR CAST(amount AS TEXT) LIKE $1`;
      params.push(q);
    }

    query += ' ORDER BY date DESC, created_at DESC';

    const result = await pool.query(query, params);

    // Convert DB rows to frontend format
    const transactions = result.rows.map(row => ({
      id: row.id,
      date: row.date,
      bank_desc: row.bank_desc || '',
      gl_desc: row.gl_desc || '',
      amount: parseFloat(row.amount),
      currency: row.currency,
      bank_name: row.bank_name,
      match_type: row.match_type,
      confidence: row.confidence,
      status: row.status,
      approval_stage: row.approval_stage,
      flags: row.flags || [],
      bank_tx_id: row.bank_tx_id,
      gl_tx_id: row.gl_tx_id,
    }));

    res.json(transactions);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// PATCH /api/transactions/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['matched', 'pending', 'unmatched', 'rejected', 'approved'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const result = await pool.query(
      'UPDATE matched_transactions SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const match = result.rows[0];

    // Learn from rejection — create an 'exclude' rule to prevent this pairing
    if (status === 'rejected' && match.bank_desc && match.gl_desc) {
      try {
        // Look up bank transaction_type if available
        let bankTxType: string | null = null;
        let glSource: string | null = null;
        if (match.bank_tx_id) {
          const bankRow = await pool.query('SELECT transaction_type FROM bank_transactions WHERE id = $1', [match.bank_tx_id]);
          if (bankRow.rows.length > 0) bankTxType = bankRow.rows[0].transaction_type;
        }
        if (match.gl_tx_id) {
          const glRow = await pool.query('SELECT source FROM gl_transactions WHERE id = $1', [match.gl_tx_id]);
          if (glRow.rows.length > 0) glSource = glRow.rows[0].source;
        }

        const bankPattern = extractPattern(match.bank_desc);
        const glPattern = extractPattern(match.gl_desc);

        if (bankPattern.length >= 3 || glPattern.length >= 3) {
          // Check for duplicate exclude rule
          const existing = await pool.query(
            `SELECT id, times_applied FROM matching_rules
             WHERE rule_type = 'exclude'
               AND COALESCE(bank_tx_type, '') = COALESCE($1, '')
               AND COALESCE(gl_source, '') = COALESCE($2, '')
               AND bank_pattern = $3
               AND gl_pattern = $4`,
            [bankTxType || '', glSource || '', bankPattern, glPattern]
          );

          if (existing.rows.length > 0) {
            await pool.query(
              'UPDATE matching_rules SET times_applied = times_applied + 1 WHERE id = $1',
              [existing.rows[0].id]
            );
          } else {
            await pool.query(
              `INSERT INTO matching_rules
               (id, rule_type, bank_pattern, bank_tx_type, gl_pattern, gl_source,
                confidence_boost, created_from)
               VALUES ($1, 'exclude', $2, $3, $4, $5, -100, $6)`,
              [generateId('RULE'), bankPattern, bankTxType, glPattern, glSource, id]
            );
          }
        }
      } catch (learnErr) {
        console.error('Failed to create exclude rule (non-fatal):', learnErr);
      }
    }

    res.json(match);
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /api/transactions/:id/approval
router.patch('/:id/approval', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { approval_stage } = req.body;
  const validStages = ['none', 'submitted', 'review', 'posted'];

  if (!validStages.includes(approval_stage)) {
    return res.status(400).json({ error: 'Invalid approval stage' });
  }

  try {
    const result = await pool.query(
      'UPDATE matched_transactions SET approval_stage = $1 WHERE id = $2 RETURNING *',
      [approval_stage, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating approval stage:', err);
    res.status(500).json({ error: 'Failed to update approval stage' });
  }
});

// DELETE /api/transactions - clear all matched transactions
// Preserves outstanding items from closed periods
router.delete('/', async (_req: Request, res: Response) => {
  try {
    // Only delete matched_transactions — outstanding_items from closed periods are preserved
    await pool.query('DELETE FROM matched_transactions');

    // Preserve outstanding items that belong to closed periods
    // Only delete outstanding items from open periods
    await pool.query(
      `DELETE FROM outstanding_items
       WHERE period NOT IN (SELECT id FROM reconciliation_periods WHERE status = 'closed')
         AND source_period NOT IN (SELECT id FROM reconciliation_periods WHERE status = 'closed')`
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing transactions:', err);
    res.status(500).json({ error: 'Failed to clear transactions' });
  }
});

// DELETE /api/transactions/reset-all - FULL DATABASE RESET for testing
// Wipes ALL data including closed periods
router.delete('/reset-all', async (_req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM matched_transactions');
    await pool.query('DELETE FROM outstanding_items');
    await pool.query('DELETE FROM reconciliation_adjustments');
    await pool.query('DELETE FROM reconciliation_periods');
    await pool.query('DELETE FROM bank_transactions');
    await pool.query('DELETE FROM gl_transactions');
    await pool.query('DELETE FROM bank_metadata');
    await pool.query('DELETE FROM matching_rules');
    res.json({ success: true, message: 'All data has been reset' });
  } catch (err) {
    console.error('Error resetting all data:', err);
    res.status(500).json({ error: 'Failed to reset all data' });
  }
});

export default router;
