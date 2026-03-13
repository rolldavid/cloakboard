/**
 * V19 Migration — Performance indexes
 *
 * Adds B-tree index on duels.slug for fast uniqueness checks,
 * and composite indexes on comments and vote_snapshots for cron/query efficiency.
 */

import type { Pool } from 'pg';

const MIGRATION_V19_SQL = `
-- Fast slug lookups (duel creation, detail page, share page)
CREATE INDEX IF NOT EXISTS idx_duels_slug ON duels (slug);

-- Comment queries by duel + recency
CREATE INDEX IF NOT EXISTS idx_comments_duel_created ON comments (duel_id, created_at DESC);

-- Recent comments count (trending sidebar)
CREATE INDEX IF NOT EXISTS idx_comments_recent ON comments (created_at DESC) WHERE is_deleted = false;

-- Vote snapshots time-range lookups
CREATE INDEX IF NOT EXISTS idx_vote_snapshots_duel_time ON vote_snapshots (duel_id, snapshot_at DESC);
`;

export async function runMigrateV19(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V19_SQL);
    console.log('[migrate_v19] Performance indexes applied');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v19] Already applied');
    } else {
      console.warn('[migrate_v19] Warning:', err?.message);
    }
  }
}
