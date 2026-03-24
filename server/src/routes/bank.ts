import { Router, Request, Response } from 'express';
import pool from '../db';

const router = Router();

// GET /api/bank-transactions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM bank_transactions ORDER BY date DESC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching bank transactions:', err);
    res.status(500).json({ error: 'Failed to fetch bank transactions' });
  }
});

// POST /api/bank-transactions/import
router.post('/import', async (req: Request, res: Response) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No transactions provided' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let imported = 0;

    for (const tx of transactions) {
      // Duplicate detection: skip if same date+amount+description exists
      const exists = await client.query(
        `SELECT 1 FROM bank_transactions
         WHERE date = $1 AND amount = $2 AND description = $3 LIMIT 1`,
        [tx.date, tx.amount, tx.description]
      );

      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO bank_transactions (id, date, description, amount, currency, type, reference, bank_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tx.id, tx.date, tx.description, tx.amount, tx.currency || 'EUR', tx.type, tx.reference || null, tx.bank_name || 'BOC']
        );
        imported++;
      }
    }

    await client.query('COMMIT');
    res.json({ imported, total: transactions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing bank transactions:', err);
    res.status(500).json({ error: 'Failed to import bank transactions' });
  } finally {
    client.release();
  }
});

// DELETE /api/bank-transactions
router.delete('/', async (_req: Request, res: Response) => {
  try {
    // First remove references from matched_transactions
    await pool.query('UPDATE matched_transactions SET bank_tx_id = NULL WHERE bank_tx_id IS NOT NULL');
    await pool.query('DELETE FROM bank_transactions');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing bank transactions:', err);
    res.status(500).json({ error: 'Failed to clear bank transactions' });
  }
});

export default router;
