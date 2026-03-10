import pg from 'pg';

/**
 * V13 Migration: Breaking news duels support.
 *
 * Adds is_breaking flag to duels table and a tracking table
 * to prevent duplicate news stories from being published.
 */
export const MIGRATION_V13_SQL = `
-- ============================================================
-- V13 Migration: Breaking news duels
-- ============================================================

-- Flag for duels created by the breaking news agent
ALTER TABLE duels ADD COLUMN IF NOT EXISTS is_breaking BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS breaking_source_url TEXT;

-- Index for fast filtering of breaking duels
CREATE INDEX IF NOT EXISTS idx_duels_is_breaking ON duels (is_breaking) WHERE is_breaking = true;

-- Track published news stories to prevent duplicates
CREATE TABLE IF NOT EXISTS breaking_news_log (
  id SERIAL PRIMARY KEY,
  source_url TEXT UNIQUE NOT NULL,
  title_hash TEXT NOT NULL,
  duel_id INTEGER REFERENCES duels(id),
  news_category TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_breaking_news_log_created ON breaking_news_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_breaking_news_log_title_hash ON breaking_news_log (title_hash);
`;

/** Run V13 migration using any pg.Pool. */
export async function runMigrateV13(pool: pg.Pool): Promise<void> {
  console.log('[migrate_v13] Running V13 migration (breaking news duels)...');
  await pool.query(MIGRATION_V13_SQL);
  console.log('[migrate_v13] Done.');
}
