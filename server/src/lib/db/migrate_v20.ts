/**
 * V20 Migration — Market voting system support
 *
 * Adds winning_direction and finalized_at columns to duels table
 * for recording on-chain duel outcomes.
 *
 * Adds initial_point_grants table to track 500-point welcome grants.
 */

import type { Pool } from 'pg';

const MIGRATION_V20_SQL = `
-- Market voting: track which side won after duel ends
ALTER TABLE duels ADD COLUMN IF NOT EXISTS winning_direction INT;
ALTER TABLE duels ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- Track initial 500-point grants to prevent double-granting
CREATE TABLE IF NOT EXISTS initial_point_grants (
  address TEXT PRIMARY KEY,
  granted_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function runMigrateV20(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V20_SQL);
    console.log('[migrate_v20] Market voting columns + initial_point_grants table applied');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v20] Already applied');
    } else {
      console.warn('[migrate_v20] Warning:', err?.message);
    }
  }
}
