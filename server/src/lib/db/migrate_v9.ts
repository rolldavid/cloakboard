import pg from 'pg';

export const MIGRATION_V9_SQL = `
-- ============================================================
-- V9 Migration: Performance indexes
-- ============================================================

-- Composite index for comments filtered by duel + period
CREATE INDEX IF NOT EXISTS idx_comments_duel_period
  ON comments (duel_id, period_id);

-- Period status index (used in cron + period filtering)
CREATE INDEX IF NOT EXISTS idx_duel_periods_status
  ON duel_periods (duel_id, status);

-- Option votes by duel (used in sort + display)
CREATE INDEX IF NOT EXISTS idx_duel_options_votes
  ON duel_options (duel_id, vote_count DESC);

-- Level votes by duel
CREATE INDEX IF NOT EXISTS idx_duel_levels_votes
  ON duel_levels (duel_id, vote_count DESC);
`;

/** Run V9 migration using any pg.Pool. */
export async function runMigrateV9(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v9] Running V9 migration (performance indexes)...');
  await externalPool.query(MIGRATION_V9_SQL);
  console.log('[migrate_v9] Done.');
}
