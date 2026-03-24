import express from 'express';
import cors from 'cors';
import { runMigrations } from './migrate';
import bankRoutes from './routes/bank';
import glRoutes from './routes/gl';
import transactionRoutes from './routes/transactions';
import matchingRoutes from './routes/matching';
import rulesRoutes from './routes/rules';
import reconciliationRoutes from './routes/reconciliation';
import pool from './db';
import { HIGH_VALUE_THRESHOLD } from './utils/reconciliation';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/bank-transactions', bankRoutes);
app.use('/api/gl-transactions', glRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/reconciliation', reconciliationRoutes);

// GET /api/stats - dashboard statistics
app.get('/api/stats', async (_req, res) => {
  try {
    const bankCount = await pool.query('SELECT COUNT(*) FROM bank_transactions');
    const glCount = await pool.query('SELECT COUNT(*) FROM gl_transactions');
    const matchedCount = await pool.query(
      `SELECT COUNT(*) FROM matched_transactions WHERE status IN ('matched', 'approved')`
    );
    const pendingCount = await pool.query(
      `SELECT COUNT(*) FROM matched_transactions WHERE status = 'pending'`
    );
    const unmatchedCount = await pool.query(
      `SELECT COUNT(*) FROM matched_transactions WHERE status = 'unmatched'`
    );
    const totalMatches = await pool.query('SELECT COUNT(*) FROM matched_transactions');
    const highValueCount = await pool.query(
      `SELECT COUNT(*) FROM matched_transactions WHERE amount > $1`,
      [HIGH_VALUE_THRESHOLD]
    );
    const pendingAmount = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM matched_transactions WHERE status = 'pending'`
    );
    const avgConfidence = await pool.query(
      `SELECT COALESCE(AVG(confidence), 0) as avg FROM matched_transactions WHERE confidence > 0`
    );

    res.json({
      bankTransactions: parseInt(bankCount.rows[0].count),
      glTransactions: parseInt(glCount.rows[0].count),
      matchedCount: parseInt(matchedCount.rows[0].count),
      pendingCount: parseInt(pendingCount.rows[0].count),
      unmatchedCount: parseInt(unmatchedCount.rows[0].count),
      totalMatches: parseInt(totalMatches.rows[0].count),
      highValueAlerts: parseInt(highValueCount.rows[0].count),
      pendingAmount: parseFloat(pendingAmount.rows[0].total),
      avgConfidence: Math.round(parseFloat(avgConfidence.rows[0].avg)),
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`ReconAI Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
