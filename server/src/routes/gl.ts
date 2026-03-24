import { Router, Request, Response } from 'express';
import pool from '../db';

// Sanitize date to YYYY-MM-DD format for PostgreSQL
function sanitizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const str = String(dateStr).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or D/M/YYYY
  const slashParts = str.split('/');
  if (slashParts.length === 3) {
    const [day, month, year] = slashParts;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try native Date parsing as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  // Last resort: today's date
  return new Date().toISOString().split('T')[0];
}

const router = Router();

// GET /api/gl-transactions
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gl_transactions ORDER BY date DESC, created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching GL transactions:', err);
    res.status(500).json({ error: 'Failed to fetch GL transactions' });
  }
});

// POST /api/gl-transactions/import
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
      // Duplicate detection
      const exists = await client.query(
        `SELECT 1 FROM gl_transactions
         WHERE date = $1 AND amount = $2 AND description = $3 LIMIT 1`,
        [sanitizeDate(tx.date), tx.amount, tx.description]
      );

      if (exists.rows.length === 0) {
        await client.query(
          `INSERT INTO gl_transactions (id, date, description, amount, currency, type, reference, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [tx.id, sanitizeDate(tx.date), tx.description, tx.amount, tx.currency || 'EUR', tx.type, tx.reference || null, tx.source || 'Unknown']
        );
        imported++;
      }
    }

    await client.query('COMMIT');
    res.json({ imported, total: transactions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing GL transactions:', err);
    res.status(500).json({ error: 'Failed to import GL transactions' });
  } finally {
    client.release();
  }
});

// DELETE /api/gl-transactions
router.delete('/', async (_req: Request, res: Response) => {
  try {
    await pool.query('UPDATE matched_transactions SET gl_tx_id = NULL WHERE gl_tx_id IS NOT NULL');
    await pool.query('DELETE FROM gl_transactions');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing GL transactions:', err);
    res.status(500).json({ error: 'Failed to clear GL transactions' });
  }
});

export default router;
