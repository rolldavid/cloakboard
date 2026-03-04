import pg from 'pg';

/**
 * V10 Migration: Shift existing recurring period boundaries from UTC to EST (UTC-5).
 *
 * Old periods end at midnight UTC (00:00 UTC). New code expects midnight EST (05:00 UTC).
 * This migration shifts period_end and period_start for recurring duel periods so the
 * transition to EST-aligned periods is seamless.
 */
export const MIGRATION_V10_SQL = `
-- ============================================================
-- V10 Migration: Shift recurring period boundaries UTC → EST
-- ============================================================

-- Shift period_end from midnight UTC to midnight EST (add 5 hours)
-- Only for periods whose period_end is exactly on a UTC midnight boundary (hour=0)
UPDATE duel_periods dp
SET period_end = dp.period_end + INTERVAL '5 hours'
FROM duels d
WHERE dp.duel_id = d.id
  AND d.timing_type = 'recurring'
  AND EXTRACT(HOUR FROM dp.period_end AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM dp.period_end AT TIME ZONE 'UTC') = 0;

-- Shift period_start for non-first periods (those starting at midnight UTC, i.e. from cron)
-- First periods start at duel creation time (arbitrary), so only shift midnight-aligned ones
UPDATE duel_periods dp
SET period_start = dp.period_start + INTERVAL '5 hours'
FROM duels d
WHERE dp.duel_id = d.id
  AND d.timing_type = 'recurring'
  AND EXTRACT(HOUR FROM dp.period_start AT TIME ZONE 'UTC') = 0
  AND EXTRACT(MINUTE FROM dp.period_start AT TIME ZONE 'UTC') = 0;
`;

/** Run V10 migration using any pg.Pool. */
export async function runMigrateV10(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v10] Running V10 migration (UTC → EST period boundaries)...');
  await externalPool.query(MIGRATION_V10_SQL);
  console.log('[migrate_v10] Done.');
}
