/**
 * Staking reward computation — determines how many points a staker earns
 * based on how many votes the staked duel received relative to the platform average.
 *
 * Reward curve:
 * - Below average votes: linear ramp from 100 to 500
 * - Above average votes: exponential approach to 1000 (diminishing returns)
 * - Stake multiplier: log-scale bonus for staking more than the minimum
 *
 * Early participant advantage: when the platform is young, the average is naturally
 * low, so even modest vote counts earn high rewards. No special logic needed.
 */

import { pool } from '../db/pool.js';

export const MIN_VOTES_THRESHOLD = parseInt(process.env.MIN_VOTES_THRESHOLD || '5', 10);
const MAX_REWARD = 500;
const DEFAULT_MIN_STAKE = 10;

/**
 * Compute the reward for a staked duel based on vote performance.
 * Returns 0 if totalVotes < MIN_VOTES_THRESHOLD (stake should be burned).
 *
 * Reward curve:
 * - Base reward: slow log curve from votes (0 → ~150 at 200 votes with avg=5)
 * - Stake multiplier: sqrt-scale so higher stakes earn meaningfully more
 *   e.g. 10 pts = 1x, 50 pts = 2.24x, 100 pts = 3.16x, 500 pts = 7.07x
 * - Final reward capped at MAX_REWARD (500)
 */
export function computeReward(
  totalVotes: number,
  stakeAmount: number,
  avgVotes: number,
  minStake: number = DEFAULT_MIN_STAKE,
  maxReward: number = MAX_REWARD,
): number {
  if (totalVotes < MIN_VOTES_THRESHOLD) return 0; // burned

  // Base reward: logarithmic curve, slow growth
  // ~30 at 15 votes, ~80 at 50 votes, ~130 at 200 votes (with avgVotes=5)
  const ratio = totalVotes / Math.max(avgVotes, 1);
  const baseReward = 60 * Math.log(1 + ratio);

  // Stake multiplier: sqrt-scale for clear differentiation
  // 10 = 1x, 50 = 2.24x, 100 = 3.16x, 500 = 7.07x
  const stakeMultiplier = Math.sqrt(Math.max(stakeAmount, minStake) / minStake);
  const reward = baseReward * stakeMultiplier;

  return Math.min(maxReward, Math.floor(reward));
}

/**
 * Compute the stake multiplier for display purposes.
 */
export function computeMultiplier(stakeAmount: number, minStake: number = DEFAULT_MIN_STAKE): number {
  return Math.round(Math.sqrt(Math.max(stakeAmount, minStake) / minStake) * 100) / 100;
}

/**
 * Get the average vote count from the last N completed staked duels.
 * Falls back to fixed values when not enough data exists.
 */
export async function getRecentAvgVotes(lookback: number = 100): Promise<number> {
  const result = await pool.query(`
    SELECT AVG(total_votes)::float AS avg_votes, COUNT(*) AS cnt
    FROM (
      SELECT total_votes
      FROM duels
      WHERE queue_status = 'live'
        AND stake_status IN ('rewarded', 'burned')
        AND status = 'ended'
      ORDER BY stake_resolved_at DESC NULLS LAST
      LIMIT $1
    ) recent
  `, [lookback]);

  const { avg_votes, cnt } = result.rows[0] || {};

  // Bootstrapping: use fixed average when too few data points
  if (!cnt || cnt < 10) return 5;
  return avg_votes || 5;
}

/**
 * Get platform-wide staking statistics.
 */
export async function getStakingStats(): Promise<{
  totalStaked: number;
  totalBurned: number;
  totalRewarded: number;
  activeDuels: number;
  queuedDuels: number;
  avgReward: number;
}> {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN stake_status IS NOT NULL THEN staked_amount ELSE 0 END), 0)::int AS total_staked,
      COALESCE(SUM(CASE WHEN stake_status = 'burned' THEN staked_amount ELSE 0 END), 0)::int AS total_burned,
      COALESCE(SUM(CASE WHEN stake_status = 'rewarded' THEN stake_reward ELSE 0 END), 0)::int AS total_rewarded,
      COUNT(CASE WHEN queue_status = 'live' AND status = 'active' THEN 1 END)::int AS active_duels,
      COUNT(CASE WHEN queue_status = 'queued' THEN 1 END)::int AS queued_duels,
      COALESCE(AVG(CASE WHEN stake_status = 'rewarded' THEN stake_reward END)::int, 0) AS avg_reward
    FROM duels
  `);

  return result.rows[0];
}
