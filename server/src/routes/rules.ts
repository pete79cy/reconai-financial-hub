import { Router, Request, Response } from 'express';
import pool from '../db';
import { HIGH_VALUE_THRESHOLD } from '../utils/reconciliation';

const router = Router();

// GET /api/rules
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM rules WHERE id = 1');
    if (result.rows.length === 0) {
      return res.json({ weekendAlert: true, highValue: true });
    }
    const row = result.rows[0];
    res.json({
      weekendAlert: row.weekend_alert,
      highValue: row.high_value,
    });
  } catch (err) {
    console.error('Error fetching rules:', err);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// PATCH /api/rules
router.patch('/', async (req: Request, res: Response) => {
  const { weekendAlert, highValue } = req.body;

  try {
    const result = await pool.query(
      `UPDATE rules SET
        weekend_alert = COALESCE($1, weekend_alert),
        high_value = COALESCE($2, high_value)
       WHERE id = 1 RETURNING *`,
      [weekendAlert, highValue]
    );

    const row = result.rows[0];

    // Recalculate flags on all matched transactions
    const txResult = await pool.query('SELECT id, amount, date FROM matched_transactions');
    for (const tx of txResult.rows) {
      const flags: string[] = [];
      const amount = parseFloat(tx.amount);
      if (row.high_value && amount > HIGH_VALUE_THRESHOLD) flags.push('High Value');
      const day = new Date(tx.date).getDay();
      if (row.weekend_alert && (day === 0 || day === 6)) flags.push('Weekend');

      await pool.query('UPDATE matched_transactions SET flags = $1 WHERE id = $2', [flags, tx.id]);
    }

    res.json({
      weekendAlert: row.weekend_alert,
      highValue: row.high_value,
    });
  } catch (err) {
    console.error('Error updating rules:', err);
    res.status(500).json({ error: 'Failed to update rules' });
  }
});

export default router;
