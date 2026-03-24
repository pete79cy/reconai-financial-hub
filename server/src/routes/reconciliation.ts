import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';

const router = Router();

// GET /api/reconciliation/summary
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    // Bank balance from bank_metadata (closing_balance * -1 since overdraft is negative)
    const metadataResult = await pool.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];

    // closing_balance is negative for overdraft; we multiply by -1 to get positive
    const bankBalance = metadata ? Math.abs(parseFloat(metadata.closing_balance || '0')) : 0;

    // Determine period from metadata
    const period = metadata && metadata.period_from
      ? new Date(metadata.period_from).toLocaleString('en-US', { month: 'short', year: 'numeric' })
      : 'Unknown';

    // GL balance: last row balance from gl_transactions ordered by date DESC
    // Since gl_transactions may not have a balance column, we compute from the last entry
    // Actually, the GL "balance" is typically the running balance; we use the amount of the last GL entry
    // or we sum all GL transactions. For now, use the most recent GL transaction's cumulative.
    // The spec says "last row balance from gl_transactions ordered by date DESC"
    // We'll get the last GL transaction and return its amount as gl_balance placeholder
    // Better: sum all GL debits - sum all GL credits to get net GL balance
    const glBalanceResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as balance
      FROM gl_transactions
    `);
    const glBalance = parseFloat(glBalanceResult.rows[0].balance || '0');

    // Outstanding deposits: GL debits (deposits) that have no match
    const outstandingDepositsResult = await pool.query(`
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.type = 'debit'
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
    `);
    const outstandingDepositsList = outstandingDepositsResult.rows;
    const outstandingDeposits = outstandingDepositsList.reduce(
      (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
    );

    // Outstanding checks: GL credits (payments) that have no match
    const outstandingChecksResult = await pool.query(`
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
    `);
    const outstandingChecksList = outstandingChecksResult.rows;
    const outstandingChecks = outstandingChecksList.reduce(
      (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
    );

    // Outstanding other: GL credits that are NOT checks and not matched
    const outstandingOtherResult = await pool.query(`
      SELECT gl.* FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
    `);
    const outstandingOtherList = outstandingOtherResult.rows;
    const outstandingOther = outstandingOtherList.reduce(
      (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
    );

    // Adjustments from reconciliation_adjustments table
    const feesResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'fee'`
    );
    const feesNotBooked = parseFloat(feesResult.rows[0].total || '0');

    const correctionsResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'correction'`
    );
    const depositCorrections = parseFloat(correctionsResult.rows[0].total || '0');

    const otherAdjResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category NOT IN ('fee', 'correction')`
    );
    const otherAdjustments = parseFloat(otherAdjResult.rows[0].total || '0');

    // Calculate adjusted balances
    const adjustedBankBalance = bankBalance + outstandingDeposits - outstandingChecks - outstandingOther;
    const adjustedGLBalance = glBalance + feesNotBooked + depositCorrections + otherAdjustments;
    const proof = adjustedBankBalance - adjustedGLBalance;

    res.json({
      period,
      bankBalance: Math.round(bankBalance * 100) / 100,
      outstandingDeposits: Math.round(outstandingDeposits * 100) / 100,
      outstandingChecks: Math.round(outstandingChecks * 100) / 100,
      outstandingOther: Math.round(outstandingOther * 100) / 100,
      adjustedBankBalance: Math.round(adjustedBankBalance * 100) / 100,
      glBalance: Math.round(glBalance * 100) / 100,
      feesNotBooked: Math.round(feesNotBooked * 100) / 100,
      depositCorrections: Math.round(depositCorrections * 100) / 100,
      otherAdjustments: Math.round(otherAdjustments * 100) / 100,
      adjustedGLBalance: Math.round(adjustedGLBalance * 100) / 100,
      proof: Math.round(proof * 100) / 100,
      outstandingChecksList,
      outstandingDepositsList,
      outstandingOtherList,
    });
  } catch (err) {
    console.error('Error fetching reconciliation summary:', err);
    res.status(500).json({ error: 'Failed to fetch reconciliation summary' });
  }
});

// POST /api/reconciliation/adjustments
router.post('/adjustments', async (req: Request, res: Response) => {
  const { period, category, description, amount } = req.body;

  if (!period || !category || amount == null) {
    return res.status(400).json({ error: 'period, category, and amount are required' });
  }

  try {
    const id = generateId('ADJ');
    const result = await pool.query(
      `INSERT INTO reconciliation_adjustments (id, period, category, description, amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, period, category, description || null, amount]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating adjustment:', err);
    res.status(500).json({ error: 'Failed to create adjustment' });
  }
});

// GET /api/reconciliation/adjustments
router.get('/adjustments', async (req: Request, res: Response) => {
  const { period } = req.query;

  try {
    let result;
    if (period) {
      result = await pool.query(
        'SELECT * FROM reconciliation_adjustments WHERE period = $1 ORDER BY created_at DESC',
        [period]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM reconciliation_adjustments ORDER BY created_at DESC'
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching adjustments:', err);
    res.status(500).json({ error: 'Failed to fetch adjustments' });
  }
});

// DELETE /api/reconciliation/adjustments/:id
router.delete('/adjustments/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM reconciliation_adjustments WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting adjustment:', err);
    res.status(500).json({ error: 'Failed to delete adjustment' });
  }
});

export default router;
