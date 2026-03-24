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
    console.log('Database migrations completed successfully');
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}
