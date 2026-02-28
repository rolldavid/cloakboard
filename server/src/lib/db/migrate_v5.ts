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

export const MIGRATION_V5_SQL = `
-- ============================================================
-- V5 Migration: Keeper store in PostgreSQL (replaces JSON file)
-- ============================================================

CREATE TABLE IF NOT EXISTS keeper_cloaks (
  cloak_address VARCHAR(66) PRIMARY KEY,
  cloak_name VARCHAR(64) NOT NULL DEFAULT '',
  cloak_slug VARCHAR(64) NOT NULL DEFAULT '',
  tally_mode INTEGER NOT NULL DEFAULT 0,
  sender_addresses TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keeper_cloaks_slug ON keeper_cloaks (cloak_slug);
`;

/** Run V5 migration using any pg.Pool. Safe to call multiple times (IF NOT EXISTS). */
export async function runMigrateV5(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v5] Running V5 migrations...');
  await externalPool.query(MIGRATION_V5_SQL);
  console.log('[migrate_v5] Done.');
}

// --- CLI entry point ---
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateV5() {
  try {
    await runMigrateV5(pool);
  } catch (err: any) {
    console.error('[migrate_v5] Error:', err?.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1]?.includes('migrate_v5');
if (isDirectRun) migrateV5();
