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

export const MIGRATION_V4_SQL = `
-- ============================================================
-- V4 Migration: Council invite & removal voting
-- ============================================================

-- 1. Council invites
CREATE TABLE IF NOT EXISTS council_invites (
  id SERIAL PRIMARY KEY,
  cloak_address VARCHAR(66) NOT NULL,
  username VARCHAR(31) NOT NULL,
  invited_by VARCHAR(66) NOT NULL,
  claimed_by VARCHAR(66),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  UNIQUE(cloak_address, username)
);

CREATE INDEX IF NOT EXISTS idx_council_invites_cloak ON council_invites (cloak_address);
CREATE INDEX IF NOT EXISTS idx_council_invites_username ON council_invites (username);

-- 2. Council removal proposals
-- Drop and recreate if schema changed (no production data yet)
DROP TABLE IF EXISTS council_removal_votes CASCADE;
DROP TABLE IF EXISTS council_removals CASCADE;

CREATE TABLE council_removals (
  id SERIAL PRIMARY KEY,
  cloak_address VARCHAR(66) NOT NULL,
  target_address VARCHAR(66) NOT NULL,
  target_username VARCHAR(31),
  proposed_by VARCHAR(66) NOT NULL,
  proposed_by_username VARCHAR(31),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  outcome VARCHAR(10)
);

CREATE INDEX IF NOT EXISTS idx_council_removals_cloak ON council_removals (cloak_address);
CREATE INDEX IF NOT EXISTS idx_council_removals_pending ON council_removals (resolved, ends_at);

-- 3. Council removal votes (keyed by username, not address)
CREATE TABLE council_removal_votes (
  removal_id INTEGER NOT NULL REFERENCES council_removals(id),
  voter_username VARCHAR(31) NOT NULL,
  vote BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (removal_id, voter_username)
);
`;

/** Run V4 migration using any pg.Pool. Safe to call multiple times (IF NOT EXISTS). */
export async function runMigrateV4(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v4] Running V4 migrations...');
  await externalPool.query(MIGRATION_V4_SQL);
  console.log('[migrate_v4] Done.');
}

// --- CLI entry point (npx tsx src/lib/db/migrate_v4.ts) ---
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateV4() {
  try {
    await runMigrateV4(pool);
  } catch (err: any) {
    console.error('[migrate_v4] Error:', err?.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run when executed directly (not when imported)
const isDirectRun = process.argv[1]?.includes('migrate_v4');
if (isDirectRun) migrateV4();
