import pg from 'pg';

export const MIGRATION_V12_SQL = `
-- ============================================================
-- V12 Migration: end_block INT → BIGINT (supports u32::MAX = 4294967295)
-- ============================================================

ALTER TABLE duels ALTER COLUMN end_block TYPE BIGINT;
ALTER TABLE duel_periods ALTER COLUMN end_block TYPE BIGINT;
`;

/** Run V12 migration using any pg.Pool. */
export async function runMigrateV12(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v12] Running V12 migration (end_block BIGINT)...');
  await externalPool.query(MIGRATION_V12_SQL);
  console.log('[migrate_v12] Done.');
}
