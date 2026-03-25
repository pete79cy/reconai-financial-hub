import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';

const router = Router();

// ============================================================
// Period Management Endpoints
// ============================================================

// GET /api/reconciliation/periods - list all periods
router.get('/periods', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reconciliation_periods ORDER BY id DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching periods:', err);
    res.status(500).json({ error: 'Failed to fetch periods' });
  }
});

// POST /api/reconciliation/periods - create or open a new period
router.post('/periods', async (req: Request, res: Response) => {
  const { period } = req.body;

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return res.status(400).json({ error: 'period is required in YYYY-MM format' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if period already exists
    const existing = await client.query(
      'SELECT * FROM reconciliation_periods WHERE id = $1',
      [period]
    );

    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return res.json(existing.rows[0]);
    }

    // Create new period
    await client.query(
      `INSERT INTO reconciliation_periods (id, status) VALUES ($1, 'open')`,
      [period]
    );

    // Find previous period: compute the month before
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    // Copy outstanding items from previous period
    const prevItems = await client.query(
      `SELECT * FROM outstanding_items WHERE period = $1 AND status = 'outstanding'`,
      [prevPeriod]
    );

    for (const item of prevItems.rows) {
      const newId = generateId('OI');
      await client.query(
        `INSERT INTO outstanding_items
         (id, period, item_type, reference_number, description, amount, date, source, gl_tx_id, source_period, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'outstanding')`,
        [
          newId,
          period,
          item.item_type,
          item.reference_number,
          item.description,
          item.amount,
          item.date,
          item.source,
          item.gl_tx_id,
          item.source_period || item.period, // preserve original source_period
        ]
      );
    }

    await client.query('COMMIT');

    const created = await pool.query(
      'SELECT * FROM reconciliation_periods WHERE id = $1',
      [period]
    );
    res.json({
      ...created.rows[0],
      carried_forward: prevItems.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating period:', err);
    res.status(500).json({ error: 'Failed to create period' });
  } finally {
    client.release();
  }
});

// POST /api/reconciliation/periods/:period/close - close/snapshot a period
router.post('/periods/:period/close', async (req: Request, res: Response) => {
  const { period } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify period exists and is open
    const periodRow = await client.query(
      'SELECT * FROM reconciliation_periods WHERE id = $1',
      [period]
    );
    if (periodRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Period not found' });
    }
    if (periodRow.rows[0].status === 'closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Period is already closed' });
    }

    // Get bank balance from bank_metadata
    const metadataResult = await client.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];
    const bankBalance = metadata ? Math.abs(parseFloat(metadata.closing_balance || '0')) : 0;

    // Get GL balance
    const glBalanceResult = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as balance
      FROM gl_transactions
    `);
    const glBalance = parseFloat(glBalanceResult.rows[0].balance || '0');

    // Outstanding items for this period
    const outstandingResult = await client.query(
      `SELECT * FROM outstanding_items WHERE period = $1 AND status = 'outstanding'`,
      [period]
    );

    let outstandingDeposits = 0;
    let outstandingChecks = 0;
    let outstandingOther = 0;
    for (const item of outstandingResult.rows) {
      const amt = parseFloat(item.amount);
      if (item.item_type === 'deposit') {
        outstandingDeposits += amt;
      } else if (item.item_type === 'cheque') {
        outstandingChecks += amt;
      } else {
        outstandingOther += amt;
      }
    }

    // Adjustments
    const feesResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'fee' AND period = $1`,
      [period]
    );
    const feesNotBooked = parseFloat(feesResult.rows[0].total || '0');

    const correctionsResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'correction' AND period = $1`,
      [period]
    );
    const depositCorrections = parseFloat(correctionsResult.rows[0].total || '0');

    const otherAdjResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category NOT IN ('fee', 'correction') AND period = $1`,
      [period]
    );
    const otherAdjustments = parseFloat(otherAdjResult.rows[0].total || '0');

    const adjustedBankBalance = bankBalance + outstandingDeposits - outstandingChecks - outstandingOther;
    const adjustedGLBalance = glBalance + feesNotBooked + depositCorrections + otherAdjustments;
    const proof = adjustedBankBalance - adjustedGLBalance;

    // Update period with snapshot
    await client.query(
      `UPDATE reconciliation_periods
       SET status = 'closed',
           bank_balance = $2,
           gl_balance = $3,
           adjusted_bank_balance = $4,
           adjusted_gl_balance = $5,
           proof = $6,
           closed_at = NOW()
       WHERE id = $1`,
      [period, bankBalance, glBalance, adjustedBankBalance, adjustedGLBalance, proof]
    );

    await client.query('COMMIT');

    res.json({
      period,
      status: 'closed',
      bank_balance: Math.round(bankBalance * 100) / 100,
      gl_balance: Math.round(glBalance * 100) / 100,
      adjusted_bank_balance: Math.round(adjustedBankBalance * 100) / 100,
      adjusted_gl_balance: Math.round(adjustedGLBalance * 100) / 100,
      proof: Math.round(proof * 100) / 100,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error closing period:', err);
    res.status(500).json({ error: 'Failed to close period' });
  } finally {
    client.release();
  }
});

// ============================================================
// Outstanding Items Endpoints
// ============================================================

// POST /api/reconciliation/outstanding/import - import outstanding items from Excel
router.post('/outstanding/import', async (req: Request, res: Response) => {
  const { period, items } = req.body;

  if (!period || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'period and items array are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure period exists
    const periodExists = await client.query(
      'SELECT id FROM reconciliation_periods WHERE id = $1',
      [period]
    );
    if (periodExists.rows.length === 0) {
      // Auto-create the period
      await client.query(
        `INSERT INTO reconciliation_periods (id, status) VALUES ($1, 'open')`,
        [period]
      );
    }

    const inserted: any[] = [];
    for (const item of items) {
      const id = generateId('OI');
      const result = await client.query(
        `INSERT INTO outstanding_items
         (id, period, item_type, reference_number, description, amount, date, source, source_period, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'outstanding')
         RETURNING *`,
        [
          id,
          period,
          item.item_type || 'cheque',
          item.reference_number || null,
          item.description || null,
          item.amount,
          item.date || null,
          item.source || null,
          period, // source_period = current period since these are newly imported
        ]
      );
      inserted.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ imported: inserted.length, items: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing outstanding items:', err);
    res.status(500).json({ error: 'Failed to import outstanding items' });
  } finally {
    client.release();
  }
});

// POST /api/reconciliation/outstanding/clear - mark items as cleared
router.post('/outstanding/clear', async (req: Request, res: Response) => {
  const { ids, cleared_in_period } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0 || !cleared_in_period) {
    return res.status(400).json({ error: 'ids array and cleared_in_period are required' });
  }

  try {
    const result = await pool.query(
      `UPDATE outstanding_items
       SET status = 'cleared',
           cleared_in_period = $2,
           cleared_date = CURRENT_DATE
       WHERE id = ANY($1) AND status = 'outstanding'
       RETURNING *`,
      [ids, cleared_in_period]
    );
    res.json({ cleared: result.rows.length, items: result.rows });
  } catch (err) {
    console.error('Error clearing outstanding items:', err);
    res.status(500).json({ error: 'Failed to clear outstanding items' });
  }
});

// GET /api/reconciliation/outstanding - get outstanding items for a period
router.get('/outstanding', async (req: Request, res: Response) => {
  const { period } = req.query;

  if (!period) {
    return res.status(400).json({ error: 'period query parameter is required' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM outstanding_items WHERE period = $1 ORDER BY date ASC, created_at ASC`,
      [period]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching outstanding items:', err);
    res.status(500).json({ error: 'Failed to fetch outstanding items' });
  }
});

// ============================================================
// Summary Endpoint (updated to support period parameter)
// ============================================================

// GET /api/reconciliation/summary
router.get('/summary', async (req: Request, res: Response) => {
  const { period } = req.query;

  try {
    // Bank balance from bank_metadata (closing_balance * -1 since overdraft is negative)
    const metadataResult = await pool.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];

    // closing_balance is negative for overdraft; we multiply by -1 to get positive
    const bankBalance = metadata ? Math.abs(parseFloat(metadata.closing_balance || '0')) : 0;

    // Determine display period from metadata or query
    const displayPeriod = period
      ? String(period)
      : metadata && metadata.period_from
        ? new Date(metadata.period_from).toLocaleString('en-US', { month: 'short', year: 'numeric' })
        : 'Unknown';

    // GL balance: sum all GL debits - sum all GL credits to get net GL balance
    const glBalanceResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as balance
      FROM gl_transactions
    `);
    const glBalance = parseFloat(glBalanceResult.rows[0].balance || '0');

    // If a period is specified, use outstanding_items table
    let outstandingChecksList: any[] = [];
    let outstandingDepositsList: any[] = [];
    let outstandingOtherList: any[] = [];
    let outstandingDeposits = 0;
    let outstandingChecks = 0;
    let outstandingOther = 0;

    if (period) {
      // Get outstanding items from the outstanding_items table for this period
      const outstandingItemsResult = await pool.query(
        `SELECT * FROM outstanding_items WHERE period = $1 AND status = 'outstanding' ORDER BY date ASC`,
        [period]
      );

      for (const item of outstandingItemsResult.rows) {
        const amt = parseFloat(item.amount);
        const mapped = {
          id: item.id,
          date: item.date,
          description: item.description || '',
          amount: amt,
          reference: item.reference_number || '',
          source_period: item.source_period,
          item_type: item.item_type,
        };
        if (item.item_type === 'deposit') {
          outstandingDepositsList.push(mapped);
          outstandingDeposits += amt;
        } else if (item.item_type === 'cheque') {
          outstandingChecksList.push(mapped);
          outstandingChecks += amt;
        } else {
          outstandingOtherList.push(mapped);
          outstandingOther += amt;
        }
      }

      // Also include new unmatched items from the current matching run
      // that are NOT already in outstanding_items
      const unmatchedGLChecks = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'credit'
          AND (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM outstanding_items WHERE gl_tx_id IS NOT NULL AND period = $1
          )
      `, [period]);
      for (const row of unmatchedGLChecks.rows) {
        const amt = parseFloat(row.amount);
        outstandingChecksList.push({
          id: row.id,
          date: row.date,
          description: row.description,
          amount: amt,
          reference: row.reference || '',
          source_period: null,
          item_type: 'cheque',
        });
        outstandingChecks += amt;
      }

      const unmatchedGLDeposits = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'debit'
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM outstanding_items WHERE gl_tx_id IS NOT NULL AND period = $1
          )
      `, [period]);
      for (const row of unmatchedGLDeposits.rows) {
        const amt = parseFloat(row.amount);
        outstandingDepositsList.push({
          id: row.id,
          date: row.date,
          description: row.description,
          amount: amt,
          reference: row.reference || '',
          source_period: null,
          item_type: 'deposit',
        });
        outstandingDeposits += amt;
      }

      const unmatchedGLOther = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'credit'
          AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM outstanding_items WHERE gl_tx_id IS NOT NULL AND period = $1
          )
      `, [period]);
      for (const row of unmatchedGLOther.rows) {
        const amt = parseFloat(row.amount);
        outstandingOtherList.push({
          id: row.id,
          date: row.date,
          description: row.description,
          amount: amt,
          reference: row.reference || '',
          source_period: null,
          item_type: 'other',
        });
        outstandingOther += amt;
      }
    } else {
      // No period specified - use legacy logic from matched_transactions
      const outstandingDepositsResult = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'debit'
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
      `);
      outstandingDepositsList = outstandingDepositsResult.rows;
      outstandingDeposits = outstandingDepositsList.reduce(
        (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
      );

      const outstandingChecksResult = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'credit'
          AND (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
      `);
      outstandingChecksList = outstandingChecksResult.rows;
      outstandingChecks = outstandingChecksList.reduce(
        (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
      );

      const outstandingOtherResult = await pool.query(`
        SELECT gl.* FROM gl_transactions gl
        WHERE gl.type = 'credit'
          AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
          AND gl.id NOT IN (
            SELECT gl_tx_id FROM matched_transactions
            WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
          )
      `);
      outstandingOtherList = outstandingOtherResult.rows;
      outstandingOther = outstandingOtherList.reduce(
        (sum: number, row: any) => sum + parseFloat(row.amount || '0'), 0
      );
    }

    // Adjustments from reconciliation_adjustments table
    const adjPeriodFilter = period ? ' AND period = $1' : '';
    const adjParams = period ? [period] : [];

    const feesResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'fee'${adjPeriodFilter}`,
      adjParams
    );
    const feesNotBooked = parseFloat(feesResult.rows[0].total || '0');

    const correctionsResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'correction'${adjPeriodFilter}`,
      adjParams
    );
    const depositCorrections = parseFloat(correctionsResult.rows[0].total || '0');

    const otherAdjResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category NOT IN ('fee', 'correction')${adjPeriodFilter}`,
      adjParams
    );
    const otherAdjustments = parseFloat(otherAdjResult.rows[0].total || '0');

    // Calculate adjusted balances
    const adjustedBankBalance = bankBalance + outstandingDeposits - outstandingChecks - outstandingOther;
    const adjustedGLBalance = glBalance + feesNotBooked + depositCorrections + otherAdjustments;
    const proof = adjustedBankBalance - adjustedGLBalance;

    // Fetch adjustment line items for display
    const adjustmentsResult = period
      ? await pool.query(
          'SELECT * FROM reconciliation_adjustments WHERE period = $1 ORDER BY created_at DESC',
          [period]
        )
      : await pool.query(
          'SELECT * FROM reconciliation_adjustments ORDER BY created_at DESC'
        );

    res.json({
      period: displayPeriod,
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
      adjustments: adjustmentsResult.rows,
    });
  } catch (err) {
    console.error('Error fetching reconciliation summary:', err);
    res.status(500).json({ error: 'Failed to fetch reconciliation summary' });
  }
});

// ============================================================
// Adjustments Endpoints (existing)
// ============================================================

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
