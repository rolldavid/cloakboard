import dotenv from 'dotenv';
import pg from 'pg';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(__filename), '../../../');

dotenv.config({ path: resolve(serverRoot, '.env.local') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: resolve(serverRoot, '.env') });
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIGRATION_SQL = `
-- Statement pool (text in Postgres, hash goes on-chain only during advance-duel)
CREATE TABLE IF NOT EXISTS statements (
  id SERIAL PRIMARY KEY,
  cloak_address TEXT NOT NULL,
  statement_hash TEXT NOT NULL,
  statement_text TEXT NOT NULL,
  on_chain BOOLEAN DEFAULT FALSE,
  used_in_duel_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cloak_address, statement_hash)
);

CREATE INDEX IF NOT EXISTS idx_statements_pool
  ON statements (cloak_address, used_in_duel_id)
  WHERE used_in_duel_id IS NULL;

-- Duel scheduling (auto-advance)
CREATE TABLE IF NOT EXISTS duel_schedule (
  cloak_address TEXT PRIMARY KEY,
  next_duel_at TIMESTAMPTZ,
  duel_interval_seconds INTEGER NOT NULL,
  auto_advance BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Duel snapshots (on-chain to Postgres mirror for fast reads)
CREATE TABLE IF NOT EXISTS duel_snapshots (
  id SERIAL PRIMARY KEY,
  cloak_address TEXT NOT NULL,
  cloak_name TEXT DEFAULT '',
  cloak_slug TEXT DEFAULT '',
  duel_id INTEGER NOT NULL,
  statement_text TEXT DEFAULT '',
  start_block INTEGER DEFAULT 0,
  end_block INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  agree_votes INTEGER DEFAULT 0,
  disagree_votes INTEGER DEFAULT 0,
  is_tallied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cloak_address, duel_id)
);
`;

async function migrate() {
  console.log('[migrate] Running migrations...');
  try {
    await pool.query(MIGRATION_SQL);
    console.log('[migrate] Done.');
  } catch (err: any) {
    console.error('[migrate] Error:', err?.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
