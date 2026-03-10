import pg from 'pg';

/**
 * V14 Migration: Breaking headline storage.
 *
 * Stores the original news headline separately from the Sonnet-reframed
 * agree/disagree statement (which goes in the title column).
 */
export const MIGRATION_V14_SQL = `
-- ============================================================
-- V14 Migration: Breaking headline column
-- ============================================================

ALTER TABLE duels ADD COLUMN IF NOT EXISTS breaking_headline TEXT;
`;

/** Run V14 migration using any pg.Pool. */
export async function runMigrateV14(pool: pg.Pool): Promise<void> {
  console.log('[migrate_v14] Running V14 migration (breaking headline)...');
  await pool.query(MIGRATION_V14_SQL);
  console.log('[migrate_v14] Done.');
}
