/**
 * Staking resolution cron — resolves ended staked duels.
 *
 * Runs every cron cycle alongside existing crons. For each ended staked duel:
 * - If total_votes >= min_votes_threshold: compute reward, call keeper resolve_stake
 * - If total_votes < min_votes_threshold: call keeper burn_stake
 *
 * Also handles staked → live transitions (creating on-chain duels).
 */

import { pool } from '../db/pool.js';
import { computeReward, getRecentAvgVotes } from './stakingRewards.js';
import { keeperResolveStake, keeperBurnStake } from './keeperStaking.js';

const MIN_VOTES_THRESHOLD = 10;

/**
 * Promote staked duels to live — creates on-chain duels for recently staked duels.
 */
export async function promoteStakedDuels(): Promise<number> {
  try {
    const result = await pool.query(`
      SELECT d.id, d.title, d.ends_at, d.duration_seconds, d.timing_type
      FROM duels d
      WHERE d.queue_status = 'staked'
        AND d.on_chain_id IS NULL
        AND d.is_breaking IS NOT TRUE
      LIMIT 5
    `);

    if (result.rows.length === 0) return 0;

    const { createDuelOnChain } = await import('../keeper/createDuelOnChain.js');
    const { getNode } = await import('../keeper/wallet.js');
    const { getBlockClock } = await import('../blockClock.js');

    const node = await getNode();
    const currentBlock = await node.getBlockNumber();
    const clock = getBlockClock();
    const avgBlockTime = clock.avgBlockTime || 30;

    let promoted = 0;
    for (const row of result.rows) {
      try {
        // Compute end block
        let endBlock: number;
        if (row.ends_at) {
          const remainingSeconds = Math.max(0, (new Date(row.ends_at).getTime() - Date.now()) / 1000);
          endBlock = currentBlock + Math.ceil(remainingSeconds / avgBlockTime);
        } else if (row.duration_seconds) {
          endBlock = currentBlock + Math.ceil(row.duration_seconds / avgBlockTime);
        } else {
          endBlock = 4294967295; // u32::MAX
        }

        const onChainId = await createDuelOnChain(row.title, endBlock);
        await pool.query(
          `UPDATE duels SET queue_status = 'live', status = 'active', on_chain_id = $1, end_block = $2 WHERE id = $3`,
          [onChainId, endBlock, row.id],
        );

        console.log(`[stakingCron] Promoted duel ${row.id} to live (onChainId=${onChainId})`);
        promoted++;
      } catch (err: any) {
        console.error(`[stakingCron] Failed to promote duel ${row.id}:`, err?.message);
      }
    }

    return promoted;
  } catch (err: any) {
    console.error('[stakingCron:promote] Error:', err?.message);
    return 0;
  }
}

/**
 * Resolve ended staked duels — compute rewards or burn stakes.
 * Calls keeper on-chain functions to mint points back or burn stakes.
 */
export async function resolveEndedStakes(): Promise<number> {
  try {
    const duels = await pool.query(`
      SELECT d.id, d.staked_amount, d.staker_address, d.total_votes
      FROM duels d
      WHERE d.queue_status = 'live'
        AND d.stake_status = 'locked'
        AND d.status = 'ended'
        AND d.is_breaking IS NOT TRUE
      LIMIT 10
    `);

    if (duels.rows.length === 0) return 0;

    const avgVotes = await getRecentAvgVotes();
    let resolved = 0;

    for (const duel of duels.rows) {
      try {
        if (duel.total_votes >= MIN_VOTES_THRESHOLD) {
          const reward = computeReward(duel.total_votes, duel.staked_amount, avgVotes);
          const totalReturn = duel.staked_amount + reward;

          // Call keeper resolve_stake on-chain (fire-and-forget, DB is source of truth)
          keeperResolveStake(duel.id, duel.staker_address, totalReturn).catch((err: any) =>
            console.warn(`[stakingCron] On-chain resolve_stake failed for duel ${duel.id} (non-fatal):`, err?.message),
          );

          await pool.query(`
            UPDATE duels SET stake_status = 'rewarded', stake_reward = $1, stake_resolved_at = NOW()
            WHERE id = $2
          `, [reward, duel.id]);

          await pool.query(`
            INSERT INTO staking_log (duel_id, staker_address, amount, action, reward_amount)
            VALUES ($1, $2, $3, 'reward', $4)
          `, [duel.id, duel.staker_address, duel.staked_amount, reward]);

          console.log(`[stakingCron] Rewarded duel ${duel.id}: stake=${duel.staked_amount}, reward=${reward}, votes=${duel.total_votes}`);
        } else {
          // Call keeper burn_stake on-chain (fire-and-forget, DB is source of truth)
          keeperBurnStake(duel.id).catch((err: any) =>
            console.warn(`[stakingCron] On-chain burn_stake failed for duel ${duel.id} (non-fatal):`, err?.message),
          );

          await pool.query(`
            UPDATE duels SET stake_status = 'burned', queue_status = 'failed', stake_resolved_at = NOW()
            WHERE id = $1
          `, [duel.id]);

          await pool.query(`
            INSERT INTO staking_log (duel_id, staker_address, amount, action)
            VALUES ($1, $2, $3, 'burn')
          `, [duel.id, duel.staker_address, duel.staked_amount]);

          console.log(`[stakingCron] Burned stake for duel ${duel.id}: stake=${duel.staked_amount}, votes=${duel.total_votes}`);
        }

        resolved++;
      } catch (err: any) {
        console.error(`[stakingCron] Failed to resolve duel ${duel.id}:`, err?.message);
      }
    }

    return resolved;
  } catch (err: any) {
    console.error('[stakingCron:resolve] Error:', err?.message);
    return 0;
  }
}

/**
 * Combined staking cron — runs all staking tasks.
 */
export async function runStakingCron(): Promise<number> {
  const [promoted, resolved] = await Promise.all([
    promoteStakedDuels(),
    resolveEndedStakes(),
  ]);
  return promoted + resolved;
}
