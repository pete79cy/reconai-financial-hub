import { Router, Request, Response } from 'express';
import pool from '../db';

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

    res.json(result.rows[0]);
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
router.delete('/', async (_req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM matched_transactions');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing transactions:', err);
    res.status(500).json({ error: 'Failed to clear transactions' });
  }
});

export default router;
