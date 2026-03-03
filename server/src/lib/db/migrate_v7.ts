import pg from 'pg';

export const MIGRATION_V7_SQL = `
-- ============================================================
-- V7 Migration: Calendar-aligned recurring periods + start time
-- ============================================================

-- Add starts_at to duels (for duration type with scheduled start)
ALTER TABLE duels ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- Update recurrence constraint (add 'daily', keep 'weekly' for backward compat)
ALTER TABLE duels DROP CONSTRAINT IF EXISTS duels_recurrence_check;
ALTER TABLE duels ADD CONSTRAINT duels_recurrence_check
  CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'yearly'));

-- Add period_id to comments (nullable — NULL for non-recurring duels)
ALTER TABLE comments ADD COLUMN IF NOT EXISTS period_id INT REFERENCES duel_periods(id);
CREATE INDEX IF NOT EXISTS idx_comments_period ON comments (period_id) WHERE period_id IS NOT NULL;

-- Extend duel_periods with slug, end_block, status
ALTER TABLE duel_periods ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE duel_periods ADD COLUMN IF NOT EXISTS end_block INT;
ALTER TABLE duel_periods ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_duel_periods_slug ON duel_periods (duel_id, slug);

-- Per-period option vote counts (multi-item recurring duels)
CREATE TABLE IF NOT EXISTS period_option_votes (
  period_id INT REFERENCES duel_periods(id) ON DELETE CASCADE,
  option_id INT REFERENCES duel_options(id) ON DELETE CASCADE,
  vote_count INT DEFAULT 0,
  PRIMARY KEY (period_id, option_id)
);

-- Per-period level vote counts (level recurring duels)
CREATE TABLE IF NOT EXISTS period_level_votes (
  period_id INT REFERENCES duel_periods(id) ON DELETE CASCADE,
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  level INT CHECK (level BETWEEN 1 AND 10),
  vote_count INT DEFAULT 0,
  PRIMARY KEY (period_id, duel_id, level)
);
`;

/** Run V7 migration using any pg.Pool. */
export async function runMigrateV7(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v7] Running V7 migration (calendar periods + start time)...');
  await externalPool.query(MIGRATION_V7_SQL);
  console.log('[migrate_v7] Done.');
}
