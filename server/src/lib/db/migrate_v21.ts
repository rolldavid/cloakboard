/**
 * V21 Migration — Track on-chain finalization status separately from DB finalization.
 *
 * finalized_at means the server determined the winner and wrote it to DB.
 * finalized_on_chain tracks whether keeperFinalizeDuel actually succeeded on L2.
 * The retry cron uses this to re-attempt failed on-chain finalizations.
 */

import type { Pool } from 'pg';

const MIGRATION_V21_SQL = `
ALTER TABLE duels ADD COLUMN IF NOT EXISTS finalized_on_chain BOOLEAN DEFAULT FALSE;

-- Backfill: assume existing finalized duels were finalized on-chain
UPDATE duels SET finalized_on_chain = TRUE WHERE finalized_at IS NOT NULL AND finalized_on_chain IS NULL;
`;

export async function runMigrateV21(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V21_SQL);
    console.log('[migrate_v21] finalized_on_chain column applied');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v21] Already applied');
    } else {
      console.warn('[migrate_v21] Warning:', err?.message);
    }
  }
}
