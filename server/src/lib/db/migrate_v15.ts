import pg from 'pg';

/**
 * V15 Migration: Add source_domain to breaking_news_log for diversity tracking.
 */
export const MIGRATION_V15_SQL = `
-- ============================================================
-- V15 Migration: Breaking news source diversity tracking
-- ============================================================

ALTER TABLE breaking_news_log ADD COLUMN IF NOT EXISTS source_domain TEXT;
CREATE INDEX IF NOT EXISTS idx_breaking_news_log_source ON breaking_news_log (source_domain) WHERE source_domain IS NOT NULL;
`;

/** Run V15 migration using any pg.Pool. */
export async function runMigrateV15(pool: pg.Pool): Promise<void> {
  console.log('[migrate_v15] Running V15 migration (breaking news source diversity)...');
  await pool.query(MIGRATION_V15_SQL);
  console.log('[migrate_v15] Done.');
}
