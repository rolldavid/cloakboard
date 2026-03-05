import pg from 'pg';

/**
 * V11 Migration: Google user salts table for cross-app key derivation protection.
 *
 * Stores a per-user random salt keyed by SHA-256(sub) — no PII.
 */
export const MIGRATION_V11_SQL = `
-- ============================================================
-- V11 Migration: Google user salts (cross-app key protection)
-- ============================================================

CREATE TABLE IF NOT EXISTS google_user_salts (
  lookup_key TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

/** Run V11 migration using any pg.Pool. */
export async function runMigrateV11(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v11] Running V11 migration (google_user_salts)...');
  await externalPool.query(MIGRATION_V11_SQL);
  console.log('[migrate_v11] Done.');
}
