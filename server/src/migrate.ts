import pool from './db';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        currency TEXT DEFAULT 'EUR',
        type TEXT CHECK (type IN ('debit','credit')),
        reference TEXT,
        bank_name TEXT DEFAULT 'BOC',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS gl_transactions (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        currency TEXT DEFAULT 'EUR',
        type TEXT CHECK (type IN ('debit','credit')),
        reference TEXT,
        source TEXT DEFAULT 'Unknown',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS matched_transactions (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        bank_desc TEXT DEFAULT '',
        gl_desc TEXT DEFAULT '',
        amount DECIMAL(15,2) NOT NULL,
        currency TEXT DEFAULT 'EUR',
        bank_name TEXT DEFAULT 'BOC',
        match_type TEXT CHECK (match_type IN ('1:1','1:N','Manual','System')),
        confidence INTEGER DEFAULT 0,
        status TEXT CHECK (status IN ('matched','pending','unmatched','rejected','approved')) DEFAULT 'pending',
        approval_stage TEXT DEFAULT 'none',
        flags TEXT[] DEFAULT '{}',
        bank_tx_id TEXT REFERENCES bank_transactions(id) ON DELETE SET NULL,
        gl_tx_id TEXT REFERENCES gl_transactions(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY DEFAULT 1,
        weekend_alert BOOLEAN DEFAULT TRUE,
        high_value BOOLEAN DEFAULT TRUE
      );

      INSERT INTO rules (id, weekend_alert, high_value)
      VALUES (1, TRUE, TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Add new columns to bank_transactions
    await client.query(`
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transaction_type TEXT;
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reference_number TEXT;
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS value_date DATE;
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS balance DECIMAL(15,2);
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS branch_code TEXT;
    `);

    // Add new columns to gl_transactions
    await client.query(`
      ALTER TABLE gl_transactions ADD COLUMN IF NOT EXISTS sequence TEXT;
    `);

    // Add new columns to matched_transactions
    await client.query(`
      ALTER TABLE matched_transactions ADD COLUMN IF NOT EXISTS match_category TEXT;
    `);

    // New tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_adjustments (
        id TEXT PRIMARY KEY,
        period TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        amount DECIMAL(15,2) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bank_metadata (
        id SERIAL PRIMARY KEY,
        account_number TEXT,
        account_holder TEXT,
        period_from DATE,
        period_to DATE,
        opening_balance DECIMAL(15,2),
        closing_balance DECIMAL(15,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Reconciliation period management tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_periods (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'open',
        bank_balance DECIMAL(15,2),
        gl_balance DECIMAL(15,2),
        adjusted_bank_balance DECIMAL(15,2),
        adjusted_gl_balance DECIMAL(15,2),
        proof DECIMAL(15,2),
        closed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS outstanding_items (
        id TEXT PRIMARY KEY,
        period TEXT NOT NULL,
        item_type TEXT NOT NULL,
        reference_number TEXT,
        description TEXT,
        amount DECIMAL(15,2) NOT NULL,
        date DATE,
        source TEXT,
        gl_tx_id TEXT,
        source_period TEXT,
        status TEXT DEFAULT 'outstanding',
        cleared_in_period TEXT,
        cleared_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Database migrations completed successfully');
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}
