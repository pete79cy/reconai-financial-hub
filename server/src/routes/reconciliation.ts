import { Router, Request, Response } from 'express';
import pool from '../db';
import { generateId } from '../utils/id';
import {
  generateMatchedExcel, generateMatchedPDF,
  generateOutstandingExcel, generateOutstandingPDF,
} from '../utils/reports';

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

    // All outstanding items reduce the adjusted bank balance
    const adjustedBankBalance = bankBalance - outstandingDeposits - outstandingChecks - outstandingOther;
    const adjustedGLBalance = glBalance + feesNotBooked + depositCorrections + otherAdjustments;
    const proof = adjustedBankBalance - adjustedGLBalance;

    // Build full snapshot of outstanding items for this period
    // Reuse the same logic as summary endpoint for outstanding lists
    const snapChecksList: any[] = [];
    const snapDepositsList: any[] = [];
    const snapOtherList: any[] = [];

    const snapGLChecks = await client.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLChecks.rows) {
      snapChecksList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source, item_type: 'cheque',
      });
    }

    const snapGLDeposits = await client.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'debit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLDeposits.rows) {
      snapDepositsList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source, item_type: 'deposit',
      });
    }

    const snapGLOther = await client.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLOther.rows) {
      snapOtherList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source, item_type: 'other',
      });
    }

    // Carried forward outstanding items
    const snapCarried = await client.query(`SELECT * FROM outstanding_items WHERE status = 'outstanding' ORDER BY date ASC`);
    const alreadyCounted = new Set([
      ...snapGLChecks.rows.map((r: any) => r.id),
      ...snapGLDeposits.rows.map((r: any) => r.id),
      ...snapGLOther.rows.map((r: any) => r.id),
    ]);
    for (const item of snapCarried.rows) {
      if (item.gl_tx_id && alreadyCounted.has(item.gl_tx_id)) continue;
      const mapped = {
        date: item.date, description: item.description || '',
        amount: Math.abs(parseFloat(item.amount)),
        reference: item.reference_number || '',
        source_period: item.source_period || item.period, item_type: item.item_type,
      };
      if (item.item_type === 'deposit') snapDepositsList.push(mapped);
      else if (item.item_type === 'cheque') snapChecksList.push(mapped);
      else snapOtherList.push(mapped);
    }

    // Get matched transactions for this period
    const matchedResult = await client.query(
      `SELECT id, date, bank_desc, gl_desc, amount, match_type, confidence, match_category, status
       FROM matched_transactions
       WHERE status IN ('matched', 'approved', 'pending')
       ORDER BY date ASC`
    );

    // Get adjustments
    const adjustmentsSnap = await client.query(
      'SELECT * FROM reconciliation_adjustments WHERE period = $1 ORDER BY created_at DESC',
      [period]
    );

    const snapshot = {
      bankBalance: Math.round(bankBalance * 100) / 100,
      glBalance: Math.round(glBalance * 100) / 100,
      outstandingDeposits: Math.round(outstandingDeposits * 100) / 100,
      outstandingChecks: Math.round(outstandingChecks * 100) / 100,
      outstandingOther: Math.round(outstandingOther * 100) / 100,
      adjustedBankBalance: Math.round(adjustedBankBalance * 100) / 100,
      adjustedGLBalance: Math.round(adjustedGLBalance * 100) / 100,
      feesNotBooked: Math.round(feesNotBooked * 100) / 100,
      depositCorrections: Math.round(depositCorrections * 100) / 100,
      otherAdjustments: Math.round(otherAdjustments * 100) / 100,
      proof: Math.round(proof * 100) / 100,
      outstandingChecksList: snapChecksList,
      outstandingDepositsList: snapDepositsList,
      outstandingOtherList: snapOtherList,
      adjustments: adjustmentsSnap.rows,
      matchedTransactions: matchedResult.rows,
    };

    // Update period with snapshot
    await client.query(
      `UPDATE reconciliation_periods
       SET status = 'closed',
           bank_balance = $2,
           gl_balance = $3,
           adjusted_bank_balance = $4,
           adjusted_gl_balance = $5,
           proof = $6,
           snapshot = $7,
           closed_at = NOW()
       WHERE id = $1`,
      [period, bankBalance, glBalance, adjustedBankBalance, adjustedGLBalance, proof, JSON.stringify(snapshot)]
    );

    await client.query('COMMIT');

    res.json({
      period,
      status: 'closed',
      ...snapshot,
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

// PUT /api/reconciliation/outstanding/:id - update an outstanding item
router.put('/outstanding/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reference_number, date, description, amount, item_type, source } = req.body;

  try {
    const result = await pool.query(
      `UPDATE outstanding_items
       SET reference_number = COALESCE($2, reference_number),
           date = COALESCE($3, date),
           description = COALESCE($4, description),
           amount = COALESCE($5, amount),
           item_type = COALESCE($6, item_type),
           source = COALESCE($7, source)
       WHERE id = $1
       RETURNING *`,
      [id, reference_number, date, description, amount, item_type, source]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Outstanding item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating outstanding item:', err);
    res.status(500).json({ error: 'Failed to update outstanding item' });
  }
});

// DELETE /api/reconciliation/outstanding/clear-all - delete all outstanding items for a period
// IMPORTANT: must be before /:id route to avoid matching "clear-all" as an id
router.delete('/outstanding/clear-all', async (req: Request, res: Response) => {
  const { period } = req.query;

  if (!period) {
    return res.status(400).json({ error: 'period query parameter is required' });
  }

  try {
    // Check if period is closed — protect closed period data
    const periodCheck = await pool.query('SELECT status FROM reconciliation_periods WHERE id = $1', [period]);
    if (periodCheck.rows.length > 0 && periodCheck.rows[0].status === 'closed') {
      return res.status(403).json({ error: 'Cannot delete outstanding items from a closed period' });
    }

    // Only delete items belonging to this specific period (not carried forward from closed periods)
    const result = await pool.query(
      `DELETE FROM outstanding_items
       WHERE period = $1
         AND period NOT IN (SELECT id FROM reconciliation_periods WHERE status = 'closed')
       RETURNING id`,
      [period]
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error('Error clearing all outstanding items:', err);
    res.status(500).json({ error: 'Failed to clear outstanding items' });
  }
});

// DELETE /api/reconciliation/outstanding/:id - delete an outstanding item
router.delete('/outstanding/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // Check if this item belongs to a closed period
    const item = await pool.query('SELECT period FROM outstanding_items WHERE id = $1', [id]);
    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Outstanding item not found' });
    }
    const itemPeriod = item.rows[0].period;
    const periodCheck = await pool.query('SELECT status FROM reconciliation_periods WHERE id = $1', [itemPeriod]);
    if (periodCheck.rows.length > 0 && periodCheck.rows[0].status === 'closed') {
      return res.status(403).json({ error: 'Cannot delete outstanding items from a closed period' });
    }

    const result = await pool.query(
      'DELETE FROM outstanding_items WHERE id = $1 RETURNING *',
      [id]
    );
    res.json({ deleted: true, item: result.rows[0] });
  } catch (err) {
    console.error('Error deleting outstanding item:', err);
    res.status(500).json({ error: 'Failed to delete outstanding item' });
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
    // If period is closed and has a snapshot, return the frozen snapshot
    if (period) {
      const closedCheck = await pool.query(
        'SELECT status, snapshot FROM reconciliation_periods WHERE id = $1',
        [period]
      );
      if (closedCheck.rows.length > 0 && closedCheck.rows[0].status === 'closed' && closedCheck.rows[0].snapshot) {
        const snap = closedCheck.rows[0].snapshot;
        return res.json({
          period: String(period),
          ...snap,
        });
      }
    }

    // --- Live calculation for open periods ---

    // Bank balance from bank_metadata (closing_balance * -1 since overdraft is negative)
    const metadataResult = await pool.query(
      'SELECT * FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const metadata = metadataResult.rows[0];

    // Check if manual balances are set for this period
    let manualBankBalance: number | null = null;
    let manualGlBalance: number | null = null;
    if (period) {
      const periodResult = await pool.query(
        'SELECT bank_balance, gl_balance FROM reconciliation_periods WHERE id = $1',
        [period]
      );
      if (periodResult.rows.length > 0) {
        const pr = periodResult.rows[0];
        if (pr.bank_balance !== null) manualBankBalance = parseFloat(pr.bank_balance);
        if (pr.gl_balance !== null) manualGlBalance = parseFloat(pr.gl_balance);
      }
    }

    // Use manual balance if set, otherwise fall back to computed value
    const computedBankBalance = metadata ? Math.abs(parseFloat(metadata.closing_balance || '0')) : 0;
    const bankBalance = manualBankBalance !== null ? manualBankBalance : computedBankBalance;

    // Determine display period from metadata or query
    const displayPeriod = period
      ? String(period)
      : metadata && metadata.period_from
        ? new Date(metadata.period_from).toLocaleString('en-US', { month: 'short', year: 'numeric' })
        : 'Unknown';

    // GL balance: use manual if set, otherwise compute from transactions
    const glBalanceResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as balance
      FROM gl_transactions
    `);
    const computedGlBalance = parseFloat(glBalanceResult.rows[0].balance || '0');
    const glBalance = manualGlBalance !== null ? manualGlBalance : computedGlBalance;

    // ============================================================
    // Compute Outstanding Items directly from unmatched GL transactions
    // Outstanding = GL items NOT matched to any bank transaction
    // This is the single source of truth for the reconciliation proof.
    //
    // Also include outstanding_items from previous periods that are
    // still outstanding (not yet cleared by bank).
    // ============================================================
    let outstandingChecksList: any[] = [];
    let outstandingDepositsList: any[] = [];
    let outstandingOtherList: any[] = [];
    let outstandingDeposits = 0;
    let outstandingChecks = 0;
    let outstandingOther = 0;

    // 1. GL Cheques not matched to bank (Payment source = cheques)
    const unmatchedGLChecks = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of unmatchedGLChecks.rows) {
      const amt = Math.abs(parseFloat(row.amount));
      outstandingChecksList.push({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: amt,
        reference: row.sequence || '',
        source: row.source,
        item_type: 'cheque',
      });
      outstandingChecks += amt;
    }

    // 2. GL Deposits not matched to bank (debit type = money coming in)
    const unmatchedGLDeposits = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'debit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of unmatchedGLDeposits.rows) {
      const amt = Math.abs(parseFloat(row.amount));
      outstandingDepositsList.push({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: amt,
        reference: row.sequence || '',
        source: row.source,
        item_type: 'deposit',
      });
      outstandingDeposits += amt;
    }

    // 3. GL Other items not matched (credit type, not payment source)
    const unmatchedGLOther = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of unmatchedGLOther.rows) {
      const amt = Math.abs(parseFloat(row.amount));
      outstandingOtherList.push({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: amt,
        reference: row.sequence || '',
        source: row.source,
        item_type: 'other',
      });
      outstandingOther += amt;
    }

    // 4. Add ALL outstanding_items that are still 'outstanding'
    //    These include:
    //    - Imported outstanding cheques from previous months
    //    - Auto-added outstanding items from prior matching runs
    //    Exclude any whose gl_tx_id is already counted above (to avoid double-counting)
    const alreadyCountedGlIds = new Set([
      ...unmatchedGLChecks.rows.map((r: any) => r.id),
      ...unmatchedGLDeposits.rows.map((r: any) => r.id),
      ...unmatchedGLOther.rows.map((r: any) => r.id),
    ]);

    const carriedForward = await pool.query(`
      SELECT oi.* FROM outstanding_items oi
      WHERE oi.status = 'outstanding'
      ORDER BY oi.date ASC
    `);
    for (const item of carriedForward.rows) {
      // Skip if this outstanding item's GL tx is already counted from gl_transactions
      if (item.gl_tx_id && alreadyCountedGlIds.has(item.gl_tx_id)) continue;

      const amt = Math.abs(parseFloat(item.amount));
      const mapped = {
        id: item.id,
        date: item.date,
        description: item.description || '',
        amount: amt,
        reference: item.reference_number || '',
        source_period: item.source_period || item.period,
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
    // All outstanding items reduce the adjusted bank balance
    const adjustedBankBalance = bankBalance - outstandingDeposits - outstandingChecks - outstandingOther;
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
    // Check if this adjustment belongs to a closed period
    const adj = await pool.query('SELECT period FROM reconciliation_adjustments WHERE id = $1', [id]);
    if (adj.rows.length === 0) {
      return res.status(404).json({ error: 'Adjustment not found' });
    }
    const periodCheck = await pool.query('SELECT status FROM reconciliation_periods WHERE id = $1', [adj.rows[0].period]);
    if (periodCheck.rows.length > 0 && periodCheck.rows[0].status === 'closed') {
      return res.status(403).json({ error: 'Cannot delete adjustments from a closed period' });
    }

    const result = await pool.query(
      'DELETE FROM reconciliation_adjustments WHERE id = $1 RETURNING *',
      [id]
    );
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Error deleting adjustment:', err);
    res.status(500).json({ error: 'Failed to delete adjustment' });
  }
});

// POST /api/reconciliation/balances - save manual bank and GL balances
router.post('/balances', async (req: Request, res: Response) => {
  const { period, bank_balance, gl_balance } = req.body;

  if (!period) {
    return res.status(400).json({ error: 'Period is required' });
  }

  try {
    // Ensure period exists
    await pool.query(
      `INSERT INTO reconciliation_periods (id, status) VALUES ($1, 'open')
       ON CONFLICT (id) DO NOTHING`,
      [period]
    );

    // Update balances
    await pool.query(
      `UPDATE reconciliation_periods
       SET bank_balance = $2, gl_balance = $3
       WHERE id = $1`,
      [period, bank_balance ?? null, gl_balance ?? null]
    );

    res.json({ success: true, period, bank_balance, gl_balance });
  } catch (err) {
    console.error('Error saving balances:', err);
    res.status(500).json({ error: 'Failed to save balances' });
  }
});

// ============================================================
// Report Export Endpoints
// ============================================================

// GET /api/reconciliation/reports/matched?period=YYYY-MM&format=pdf|xlsx
router.get('/reports/matched', async (req: Request, res: Response) => {
  const { period, format } = req.query as { period?: string; format?: string };

  if (!format || !['pdf', 'xlsx'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf or xlsx' });
  }

  try {
    // For closed periods, use the frozen snapshot
    if (period) {
      const closedCheck = await pool.query(
        'SELECT status, snapshot FROM reconciliation_periods WHERE id = $1',
        [period]
      );
      if (closedCheck.rows.length > 0 && closedCheck.rows[0].status === 'closed' && closedCheck.rows[0].snapshot) {
        const snap = closedCheck.rows[0].snapshot;
        const rows = snap.matchedTransactions || [];
        if (format === 'xlsx') {
          return await generateMatchedExcel(res, rows, period);
        } else {
          return generateMatchedPDF(res, rows, period);
        }
      }
    }

    // Live data for open periods
    let query = `
      SELECT mt.*, bt.reference as bank_ref
      FROM matched_transactions mt
      LEFT JOIN bank_transactions bt ON mt.bank_tx_id = bt.id
      WHERE mt.status IN ('matched', 'approved')
    `;
    const params: string[] = [];

    if (period) {
      // Filter by date range for the period
      const [year, month] = period.split('-').map(Number);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
      query += ' AND mt.date >= $1 AND mt.date < $2';
      params.push(startDate, endDate);
    }
    query += ' ORDER BY mt.date ASC, mt.amount DESC';

    const result = await pool.query(query, params);
    const displayPeriod = period || 'all';

    if (format === 'xlsx') {
      await generateMatchedExcel(res, result.rows, displayPeriod);
    } else {
      generateMatchedPDF(res, result.rows, displayPeriod);
    }
  } catch (err) {
    console.error('Error generating matched report:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }
});

// GET /api/reconciliation/reports/outstanding?period=YYYY-MM&format=pdf|xlsx
router.get('/reports/outstanding', async (req: Request, res: Response) => {
  const { period, format } = req.query as { period?: string; format?: string };

  if (!format || !['pdf', 'xlsx'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf or xlsx' });
  }

  try {
    // For closed periods, use the frozen snapshot
    if (period) {
      const closedCheck = await pool.query(
        'SELECT status, snapshot FROM reconciliation_periods WHERE id = $1',
        [period]
      );
      if (closedCheck.rows.length > 0 && closedCheck.rows[0].status === 'closed' && closedCheck.rows[0].snapshot) {
        const snap = closedCheck.rows[0].snapshot;
        const summaryData = {
          bankBalance: snap.bankBalance,
          adjustedBankBalance: snap.adjustedBankBalance,
          glBalance: snap.glBalance,
          adjustedGLBalance: snap.adjustedGLBalance,
          proof: snap.proof,
        };
        if (format === 'xlsx') {
          return await generateOutstandingExcel(res, snap.outstandingChecksList || [], snap.outstandingDepositsList || [], snap.outstandingOtherList || [], summaryData, period);
        } else {
          return generateOutstandingPDF(res, snap.outstandingChecksList || [], snap.outstandingDepositsList || [], snap.outstandingOtherList || [], summaryData, period);
        }
      }
    }

    // Live calculation for open periods
    // 1. Unmatched GL cheques
    const unmatchedGLChecks = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    const outstandingChecksList: any[] = [];
    for (const row of unmatchedGLChecks.rows) {
      outstandingChecksList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source,
      });
    }

    // 2. Unmatched GL deposits
    const unmatchedGLDeposits = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'debit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    const outstandingDepositsList: any[] = [];
    for (const row of unmatchedGLDeposits.rows) {
      outstandingDepositsList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source,
      });
    }

    // 3. Unmatched GL other
    const unmatchedGLOther = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.type, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions
          WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    const outstandingOtherList: any[] = [];
    for (const row of unmatchedGLOther.rows) {
      outstandingOtherList.push({
        date: row.date, description: row.description,
        amount: Math.abs(parseFloat(row.amount)),
        reference: row.sequence || '', source: row.source,
      });
    }

    // 4. Carried forward outstanding items
    const alreadyCountedGlIds = new Set([
      ...unmatchedGLChecks.rows.map((r: any) => r.id),
      ...unmatchedGLDeposits.rows.map((r: any) => r.id),
      ...unmatchedGLOther.rows.map((r: any) => r.id),
    ]);
    const carriedForward = await pool.query(`
      SELECT oi.* FROM outstanding_items oi
      WHERE oi.status = 'outstanding'
      ORDER BY oi.date ASC
    `);
    for (const item of carriedForward.rows) {
      if (item.gl_tx_id && alreadyCountedGlIds.has(item.gl_tx_id)) continue;
      const mapped = {
        date: item.date, description: item.description || '',
        amount: Math.abs(parseFloat(item.amount)),
        reference: item.reference_number || '',
        source: item.source_period || item.period || '',
      };
      if (item.item_type === 'deposit') outstandingDepositsList.push(mapped);
      else if (item.item_type === 'cheque') outstandingChecksList.push(mapped);
      else outstandingOtherList.push(mapped);
    }

    // Get summary balances
    const bankMetaResult = await pool.query(
      'SELECT closing_balance FROM bank_metadata ORDER BY created_at DESC LIMIT 1'
    );
    const bankBalance = bankMetaResult.rows.length > 0
      ? parseFloat(bankMetaResult.rows[0].closing_balance || '0') : 0;

    const glBalanceResult = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as balance
      FROM gl_transactions
    `);
    const glBalance = parseFloat(glBalanceResult.rows[0].balance || '0');

    // Check for saved manual balances
    let finalBankBalance = bankBalance;
    let finalGlBalance = glBalance;
    if (period) {
      const periodRow = await pool.query('SELECT bank_balance, gl_balance FROM reconciliation_periods WHERE id = $1', [period]);
      if (periodRow.rows.length > 0) {
        if (periodRow.rows[0].bank_balance != null) finalBankBalance = parseFloat(periodRow.rows[0].bank_balance);
        if (periodRow.rows[0].gl_balance != null) finalGlBalance = parseFloat(periodRow.rows[0].gl_balance);
      }
    }

    const outstandingDeposits = outstandingDepositsList.reduce((s, i) => s + i.amount, 0);
    const outstandingChecks = outstandingChecksList.reduce((s, i) => s + i.amount, 0);
    const outstandingOther = outstandingOtherList.reduce((s, i) => s + i.amount, 0);
    const adjustedBankBalance = finalBankBalance - outstandingDeposits - outstandingChecks - outstandingOther;

    // Get adjustments for GL side
    const adjPeriodFilter = period ? ' AND period = $1' : '';
    const adjParams = period ? [period] : [];
    const feesResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'fee'${adjPeriodFilter}`, adjParams);
    const correctionsResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = 'correction'${adjPeriodFilter}`, adjParams);
    const otherAdjResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category NOT IN ('fee', 'correction')${adjPeriodFilter}`, adjParams);
    const adjustedGLBalance = finalGlBalance + parseFloat(feesResult.rows[0].total) + parseFloat(correctionsResult.rows[0].total) + parseFloat(otherAdjResult.rows[0].total);
    const proof = adjustedBankBalance - adjustedGLBalance;

    const summaryData = {
      bankBalance: finalBankBalance,
      adjustedBankBalance: Math.round(adjustedBankBalance * 100) / 100,
      glBalance: finalGlBalance,
      adjustedGLBalance: Math.round(adjustedGLBalance * 100) / 100,
      proof: Math.round(proof * 100) / 100,
    };

    const displayPeriod = period || 'all';

    if (format === 'xlsx') {
      await generateOutstandingExcel(res, outstandingChecksList, outstandingDepositsList, outstandingOtherList, summaryData, displayPeriod);
    } else {
      generateOutstandingPDF(res, outstandingChecksList, outstandingDepositsList, outstandingOtherList, summaryData, displayPeriod);
    }
  } catch (err) {
    console.error('Error generating outstanding report:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }
});

// POST /api/reconciliation/periods/:period/re-snapshot
// Re-generate snapshot for an already-closed period (backfill)
router.post('/periods/:period/re-snapshot', async (req: Request, res: Response) => {
  const { period } = req.params;

  try {
    const periodRow = await pool.query('SELECT * FROM reconciliation_periods WHERE id = $1', [period]);
    if (periodRow.rows.length === 0) {
      return res.status(404).json({ error: 'Period not found' });
    }
    if (periodRow.rows[0].status !== 'closed') {
      return res.status(400).json({ error: 'Period is not closed — use the close endpoint instead' });
    }

    // Use saved balances from the period row
    const bankBalance = parseFloat(periodRow.rows[0].bank_balance || '0');
    const glBalance = parseFloat(periodRow.rows[0].gl_balance || '0');

    // Build outstanding items from current data
    const snapChecksList: any[] = [];
    const snapDepositsList: any[] = [];
    const snapOtherList: any[] = [];

    const snapGLChecks = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLChecks.rows) {
      snapChecksList.push({ date: row.date, description: row.description, amount: Math.abs(parseFloat(row.amount)), reference: row.sequence || '', source: row.source, item_type: 'cheque' });
    }

    const snapGLDeposits = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'debit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLDeposits.rows) {
      snapDepositsList.push({ date: row.date, description: row.description, amount: Math.abs(parseFloat(row.amount)), reference: row.sequence || '', source: row.source, item_type: 'deposit' });
    }

    const snapGLOther = await pool.query(`
      SELECT gl.id, gl.date, gl.description, gl.amount, gl.source, gl.sequence
      FROM gl_transactions gl
      WHERE gl.type = 'credit'
        AND NOT (gl.source ILIKE '%payment%' OR gl.source ILIKE '%cheque%' OR gl.source ILIKE '%check%')
        AND gl.id NOT IN (
          SELECT gl_tx_id FROM matched_transactions WHERE gl_tx_id IS NOT NULL AND status IN ('matched', 'approved')
        )
      ORDER BY gl.date ASC
    `);
    for (const row of snapGLOther.rows) {
      snapOtherList.push({ date: row.date, description: row.description, amount: Math.abs(parseFloat(row.amount)), reference: row.sequence || '', source: row.source, item_type: 'other' });
    }

    // Carried forward outstanding items
    const snapCarried = await pool.query('SELECT * FROM outstanding_items WHERE status = \'outstanding\' ORDER BY date ASC');
    const alreadyCounted = new Set([
      ...snapGLChecks.rows.map((r: any) => r.id),
      ...snapGLDeposits.rows.map((r: any) => r.id),
      ...snapGLOther.rows.map((r: any) => r.id),
    ]);
    for (const item of snapCarried.rows) {
      if (item.gl_tx_id && alreadyCounted.has(item.gl_tx_id)) continue;
      const mapped = { date: item.date, description: item.description || '', amount: Math.abs(parseFloat(item.amount)), reference: item.reference_number || '', source_period: item.source_period || item.period, item_type: item.item_type };
      if (item.item_type === 'deposit') snapDepositsList.push(mapped);
      else if (item.item_type === 'cheque') snapChecksList.push(mapped);
      else snapOtherList.push(mapped);
    }

    const outstandingDeposits = snapDepositsList.reduce((s, i) => s + i.amount, 0);
    const outstandingChecks = snapChecksList.reduce((s, i) => s + i.amount, 0);
    const outstandingOther = snapOtherList.reduce((s, i) => s + i.amount, 0);
    const adjustedBankBalance = bankBalance - outstandingDeposits - outstandingChecks - outstandingOther;

    // Adjustments
    const feesResult = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = \'fee\' AND period = $1', [period]);
    const correctionsResult = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category = \'correction\' AND period = $1', [period]);
    const otherAdjResult = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM reconciliation_adjustments WHERE category NOT IN (\'fee\', \'correction\') AND period = $1', [period]);
    const feesNotBooked = parseFloat(feesResult.rows[0].total);
    const depositCorrections = parseFloat(correctionsResult.rows[0].total);
    const otherAdjustments = parseFloat(otherAdjResult.rows[0].total);
    const adjustedGLBalance = glBalance + feesNotBooked + depositCorrections + otherAdjustments;
    const proof = adjustedBankBalance - adjustedGLBalance;

    const matchedResult = await pool.query(
      'SELECT id, date, bank_desc, gl_desc, amount, match_type, confidence, match_category, status FROM matched_transactions WHERE status IN (\'matched\', \'approved\', \'pending\') ORDER BY date ASC'
    );
    const adjustmentsSnap = await pool.query('SELECT * FROM reconciliation_adjustments WHERE period = $1 ORDER BY created_at DESC', [period]);

    const snapshot = {
      bankBalance: Math.round(bankBalance * 100) / 100,
      glBalance: Math.round(glBalance * 100) / 100,
      outstandingDeposits: Math.round(outstandingDeposits * 100) / 100,
      outstandingChecks: Math.round(outstandingChecks * 100) / 100,
      outstandingOther: Math.round(outstandingOther * 100) / 100,
      adjustedBankBalance: Math.round(adjustedBankBalance * 100) / 100,
      adjustedGLBalance: Math.round(adjustedGLBalance * 100) / 100,
      feesNotBooked: Math.round(feesNotBooked * 100) / 100,
      depositCorrections: Math.round(depositCorrections * 100) / 100,
      otherAdjustments: Math.round(otherAdjustments * 100) / 100,
      proof: Math.round(proof * 100) / 100,
      outstandingChecksList: snapChecksList,
      outstandingDepositsList: snapDepositsList,
      outstandingOtherList: snapOtherList,
      adjustments: adjustmentsSnap.rows,
      matchedTransactions: matchedResult.rows,
    };

    await pool.query(
      'UPDATE reconciliation_periods SET snapshot = $2, adjusted_bank_balance = $3, adjusted_gl_balance = $4, proof = $5 WHERE id = $1',
      [period, JSON.stringify(snapshot), snapshot.adjustedBankBalance, snapshot.adjustedGLBalance, snapshot.proof]
    );

    res.json({ success: true, period, ...snapshot });
  } catch (err) {
    console.error('Error re-snapshotting period:', err);
    res.status(500).json({ error: 'Failed to re-snapshot period' });
  }
});

export default router;
