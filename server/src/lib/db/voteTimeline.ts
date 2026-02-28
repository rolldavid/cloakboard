import { pool } from './pool.js';

export interface TimelinePoint {
  agreePct: number;
  agreeVotes: number;
  disagreeVotes: number;
  totalVotes: number;
  snapshotAt: string;
}

/** Insert a vote timeline snapshot. Silently skips duplicates. */
export async function insertTimelineSnapshot(
  cloakAddress: string,
  duelId: number,
  agreeVotes: number,
  disagreeVotes: number,
  totalVotes: number,
  snapshotAt?: Date,
): Promise<void> {
  const agreePct = totalVotes > 0 ? (agreeVotes / totalVotes) * 100 : 50;
  const ts = snapshotAt ?? new Date();

  await pool.query(
    `INSERT INTO vote_timeline (cloak_address, duel_id, agree_pct, agree_votes, disagree_votes, total_votes, snapshot_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (cloak_address, duel_id, snapshot_at) DO UPDATE SET
       agree_pct = $3, agree_votes = $4, disagree_votes = $5, total_votes = $6`,
    [cloakAddress, duelId, agreePct, agreeVotes, disagreeVotes, totalVotes, ts],
  );
}

/** Get all timeline snapshots for a duel. */
export async function getTimelineSnapshots(
  cloakAddress: string,
  duelId: number,
): Promise<TimelinePoint[]> {
  const result = await pool.query(
    `SELECT agree_pct, agree_votes, disagree_votes, total_votes, snapshot_at
     FROM vote_timeline
     WHERE cloak_address = $1 AND duel_id = $2
     ORDER BY snapshot_at ASC`,
    [cloakAddress, duelId],
  );

  return result.rows.map((row: any) => ({
    agreePct: parseFloat(row.agree_pct),
    agreeVotes: row.agree_votes,
    disagreeVotes: row.disagree_votes,
    totalVotes: row.total_votes,
    snapshotAt: row.snapshot_at,
  }));
}

/** Get the most recent snapshot timestamp for a duel. */
export async function getLastSnapshotTime(
  cloakAddress: string,
  duelId: number,
): Promise<Date | null> {
  const result = await pool.query(
    `SELECT snapshot_at FROM vote_timeline
     WHERE cloak_address = $1 AND duel_id = $2
     ORDER BY snapshot_at DESC LIMIT 1`,
    [cloakAddress, duelId],
  );
  return result.rows.length > 0 ? new Date(result.rows[0].snapshot_at) : null;
}

/**
 * Determine the snapshot interval (in ms) based on duel age.
 * - ≤1 hour: every 1 minute
 * - >1 hour, ≤24 hours: every 15 minutes
 * - >24 hours, ≤7 days: every 1 hour
 * - >7 days, ≤30 days: every 6 hours
 * - >30 days: every 12 hours
 */
export function getSnapshotIntervalMs(duelCreatedAt: Date): number {
  const age = Date.now() - duelCreatedAt.getTime();
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  if (age <= HOUR) return 30_000;  // 30s for fresh duels
  if (age <= DAY) return 15 * MINUTE;
  if (age <= 7 * DAY) return HOUR;
  if (age <= 30 * DAY) return 6 * HOUR;
  return 12 * HOUR;
}

/**
 * Insert a snapshot if enough time has passed since the last one.
 * Returns true if a snapshot was inserted.
 */
export async function maybeInsertSnapshot(
  cloakAddress: string,
  duelId: number,
  agreeVotes: number,
  disagreeVotes: number,
  totalVotes: number,
  duelCreatedAt: Date,
): Promise<boolean> {
  const lastTime = await getLastSnapshotTime(cloakAddress, duelId);
  const interval = getSnapshotIntervalMs(duelCreatedAt);

  if (lastTime && (Date.now() - lastTime.getTime()) < interval) {
    return false; // Too soon
  }

  await insertTimelineSnapshot(cloakAddress, duelId, agreeVotes, disagreeVotes, totalVotes);
  return true;
}
