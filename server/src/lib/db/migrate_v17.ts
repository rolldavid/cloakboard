/**
 * V17 Migration — Queue system + staking columns
 *
 * Adds queue management and staking tracking to the duels table,
 * plus a staking_log table for audit trail.
 *
 * Grandfathers all existing duels as queue_status = 'live' so they
 * remain votable. Only new duels go through the queue.
 */

import type { Pool } from 'pg';

const MIGRATION_V17_SQL = `
-- Queue and staking columns on duels
ALTER TABLE duels ADD COLUMN IF NOT EXISTS queue_status TEXT
  CHECK (queue_status IN ('queued', 'staked', 'live', 'failed'))
  DEFAULT NULL;

ALTER TABLE duels ADD COLUMN IF NOT EXISTS staked_amount INT DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS staker_address TEXT;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS stake_multiplier FLOAT DEFAULT 1.0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS stake_resolved_at TIMESTAMPTZ;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS stake_reward INT DEFAULT 0;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS stake_status TEXT
  CHECK (stake_status IN ('pending', 'locked', 'returned', 'burned', 'rewarded'));

-- Index for queue queries
CREATE INDEX IF NOT EXISTS idx_duels_queue_status ON duels (queue_status)
  WHERE queue_status IS NOT NULL;

-- Staking audit log
CREATE TABLE IF NOT EXISTS staking_log (
  id SERIAL PRIMARY KEY,
  duel_id INT REFERENCES duels(id),
  staker_address TEXT NOT NULL,
  amount INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('stake', 'return', 'reward', 'burn')),
  reward_amount INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grandfather existing active duels as live (they bypass the queue)
UPDATE duels SET queue_status = 'live' WHERE status IN ('active', 'ended') AND queue_status IS NULL;
`;

export async function runMigrateV17(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V17_SQL);
    console.log('[migrate_v17] Queue + staking schema applied');
  } catch (err: any) {
    // Idempotent — columns/tables may already exist
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v17] Already applied');
    } else {
      console.warn('[migrate_v17] Warning:', err?.message);
    }
  }
}
