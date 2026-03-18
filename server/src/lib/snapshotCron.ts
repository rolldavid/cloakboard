/**
 * Vote snapshot cron — captures periodic vote tallies for time-filtered charts.
 * Called from keeperCron every cycle. Inserts snapshots for active duels
 * with throttling to avoid excessive rows.
 *
 * Also handles:
 * - processPendingOnChainDuels: safety net for duels missing on_chain_id
 * - syncOnChainTallies: periodic on-chain tally sync for active duels
 */

import { pool } from './db/pool.js';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { getBlockClock } from './blockClock.js';
import { computeNextPeriod, generatePeriodSlug } from './calendarPeriods.js';

/** Minimum interval between snapshots for a given duel (in ms). */
const SNAPSHOT_INTERVAL_MS = 1 * 60 * 1000; // 1 minute — higher resolution for short-range charts

/**
 * Take vote snapshots for all active duels that haven't been snapshotted recently.
 * Returns the number of snapshots inserted.
 */
export async function takeVoteSnapshots(): Promise<number> {
  try {
    // Get all active duels with their latest snapshot time and counts
    const result = await pool.query(`
      SELECT d.id, d.agree_count, d.disagree_count, d.total_votes, d.duel_type,
             last_snap.snapshot_at AS last_snapshot,
             last_snap.agree_count AS last_agree,
             last_snap.disagree_count AS last_disagree,
             last_snap.total_votes AS last_total,
             last_snap.option_counts AS last_option_counts
      FROM duels d
      LEFT JOIN LATERAL (
        SELECT vs.snapshot_at, vs.agree_count, vs.disagree_count, vs.total_votes, vs.option_counts
        FROM vote_snapshots vs
        WHERE vs.duel_id = d.id
        ORDER BY vs.snapshot_at DESC
        LIMIT 1
      ) last_snap ON true
      WHERE d.status = 'active'
    `);

    let inserted = 0;
    const now = new Date();

    // Batch: fetch all option counts for active multi duels
    const allOptions = await pool.query(`
      SELECT do2.duel_id, do2.id, do2.vote_count
      FROM duel_options do2
      JOIN duels d ON d.id = do2.duel_id
      WHERE d.status = 'active' AND d.duel_type = 'multi'
    `);
    const optionsByDuel = new Map<number, Array<{id: number; vote_count: number}>>();
    for (const o of allOptions.rows) {
      if (!optionsByDuel.has(o.duel_id)) optionsByDuel.set(o.duel_id, []);
      optionsByDuel.get(o.duel_id)!.push({ id: o.id, vote_count: o.vote_count });
    }

    // Batch: fetch all level counts for active level duels
    const allLevels = await pool.query(`
      SELECT dl.duel_id, dl.level, dl.vote_count
      FROM duel_levels dl
      JOIN duels d ON d.id = dl.duel_id
      WHERE d.status = 'active' AND d.duel_type = 'level'
    `);
    const levelsByDuel = new Map<number, Array<{level: number; vote_count: number}>>();
    for (const l of allLevels.rows) {
      if (!levelsByDuel.has(l.duel_id)) levelsByDuel.set(l.duel_id, []);
      levelsByDuel.get(l.duel_id)!.push({ level: l.level, vote_count: l.vote_count });
    }

    // Batch: fetch active periods for all active recurring duels
    const allPeriods = await pool.query(`
      SELECT dp.id, dp.duel_id, dp.agree_count, dp.disagree_count, dp.total_votes
      FROM duel_periods dp
      JOIN duels d ON d.id = dp.duel_id
      WHERE d.status = 'active' AND dp.status = 'active'
      ORDER BY dp.id DESC
    `);
    // Keep only latest period per duel
    const periodByDuel = new Map<number, any>();
    for (const p of allPeriods.rows) {
      if (!periodByDuel.has(p.duel_id)) periodByDuel.set(p.duel_id, p);
    }

    // Batch: fetch period option votes
    const allPeriodOpts = await pool.query(`
      SELECT pov.period_id, pov.option_id, pov.vote_count
      FROM period_option_votes pov
      JOIN duel_periods dp ON dp.id = pov.period_id
      WHERE dp.status = 'active'
    `);
    const periodOptsByPeriod = new Map<number, Array<{option_id: number; vote_count: number}>>();
    for (const po of allPeriodOpts.rows) {
      if (!periodOptsByPeriod.has(po.period_id)) periodOptsByPeriod.set(po.period_id, []);
      periodOptsByPeriod.get(po.period_id)!.push({ option_id: po.option_id, vote_count: po.vote_count });
    }

    // Batch: fetch period level votes
    const allPeriodLvls = await pool.query(`
      SELECT plv.period_id, plv.duel_id, plv.level, plv.vote_count
      FROM period_level_votes plv
      JOIN duel_periods dp ON dp.id = plv.period_id
      WHERE dp.status = 'active'
    `);
    const periodLvlsByPeriod = new Map<number, Array<{level: number; vote_count: number}>>();
    for (const pl of allPeriodLvls.rows) {
      if (!periodLvlsByPeriod.has(pl.period_id)) periodLvlsByPeriod.set(pl.period_id, []);
      periodLvlsByPeriod.get(pl.period_id)!.push({ level: pl.level, vote_count: pl.vote_count });
    }

    for (const row of result.rows) {
      const lastSnapshot = row.last_snapshot ? new Date(row.last_snapshot) : null;

      // Skip if snapshot was taken recently
      if (lastSnapshot && now.getTime() - lastSnapshot.getTime() < SNAPSHOT_INTERVAL_MS) {
        continue;
      }

      // For multi/level duels, include option/level counts as JSONB
      let optionCounts: any = null;

      if (row.duel_type === 'multi') {
        const opts = optionsByDuel.get(row.id) || [];
        optionCounts = {};
        for (const o of opts) {
          optionCounts[o.id] = o.vote_count;
        }
      } else if (row.duel_type === 'level') {
        const lvls = levelsByDuel.get(row.id) || [];
        optionCounts = {};
        for (const l of lvls) {
          optionCounts[l.level] = l.vote_count;
        }
      }

      // For recurring duels, find active period and use period-level counts
      let periodId: number | null = null;
      let snapshotAgree = row.agree_count;
      let snapshotDisagree = row.disagree_count;
      let snapshotTotal = row.total_votes;

      const period = periodByDuel.get(row.id);
      if (period) {
        periodId = period.id;
        snapshotAgree = period.agree_count;
        snapshotDisagree = period.disagree_count;
        snapshotTotal = period.total_votes;

        // Use period-level option/level counts
        if (row.duel_type === 'multi') {
          const povs = periodOptsByPeriod.get(periodId!) || [];
          optionCounts = {};
          for (const pov of povs) {
            optionCounts[pov.option_id] = pov.vote_count;
          }
        } else if (row.duel_type === 'level') {
          const plvs = periodLvlsByPeriod.get(periodId!) || [];
          optionCounts = {};
          for (const plv of plvs) {
            optionCounts[plv.level] = plv.vote_count;
          }
        }
      }

      // Skip if counts haven't changed since last snapshot (dedup)
      if (row.last_snapshot) {
        const countsMatch =
          snapshotAgree === row.last_agree &&
          snapshotDisagree === row.last_disagree &&
          snapshotTotal === row.last_total &&
          JSON.stringify(optionCounts) === JSON.stringify(row.last_option_counts);
        if (countsMatch) continue;

        // Never record a snapshot with fewer total votes than the last one.
        if (snapshotTotal < row.last_total) continue;

        // Never record a snapshot with empty option_counts if previous had data.
        // This prevents the chart from dropping to zero when a duel ends
        // (the option batch only fetches 'active' duels).
        if (row.last_option_counts && Object.keys(row.last_option_counts).length > 0
            && (!optionCounts || Object.keys(optionCounts).length === 0)) continue;
      }

      await pool.query(
        `INSERT INTO vote_snapshots (duel_id, period_id, agree_count, disagree_count, total_votes, option_counts)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, periodId, snapshotAgree, snapshotDisagree, snapshotTotal, optionCounts ? JSON.stringify(optionCounts) : null],
      );
      inserted++;
    }

    return inserted;
  } catch (err: any) {
    console.error('[snapshotCron] Error:', err?.message);
    return 0;
  }
}

/**
 * Check and end duels that have passed their ends_at time.
 * Returns the number of duels ended.
 */
export async function endExpiredDuels(): Promise<number> {
  try {
    // Grace period: wait one block time (~90s) after ends_at before finalizing,
    // allowing mempool txs to mine before winner determination
    const graceSeconds = parseInt(process.env.FINALIZATION_GRACE_SECONDS || '90', 10);
    const result = await pool.query(`
      UPDATE duels SET status = 'ended'
      WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= NOW() - make_interval(secs => $1)
      RETURNING id, slug, title, created_by, agree_count, disagree_count, total_votes,
                staker_address, staked_amount, stake_status, queue_status,
                on_chain_id, duel_type
    `, [graceSeconds]);
    const count = result.rowCount || 0;

    if (count > 0) {
      // Resolve stakes immediately for staked duels that just ended
      const stakedDuels = result.rows.filter(
        (r: any) => r.stake_status === 'locked' && r.staker_address && r.staked_amount > 0 && r.queue_status === 'live',
      );
      if (stakedDuels.length > 0) {
        try {
          const { computeReward, getRecentAvgVotes } = await import('./staking/stakingRewards.js');
          const { keeperResolveStake, keeperBurnStake } = await import('./staking/keeperStaking.js');
          const { createNotification } = await import('./notifications/notificationService.js');
          const { MIN_VOTES_THRESHOLD } = await import('./staking/stakingRewards.js');
          const { readDuelDirect } = await import('./aztec/publicStorageReader.js');
          const { getNode } = await import('./keeper/wallet.js');
          const avgVotes = await getRecentAvgVotes();

          // Lazy-load node for fresh on-chain reads
          let stakeNode: any = null;
          const stakeContractAddr = process.env.VITE_DUELCLOAK_ADDRESS;

          for (const duel of stakedDuels) {
            try {
              // Fresh on-chain tally read to avoid stale DB race condition
              let totalVotes = duel.total_votes;
              if (duel.on_chain_id && stakeContractAddr) {
                try {
                  if (!stakeNode) stakeNode = await getNode();
                  const onChainData = await readDuelDirect(stakeNode, AztecAddress.fromString(stakeContractAddr), duel.on_chain_id);
                  totalVotes = onChainData.totalVotes;
                  if (totalVotes > duel.total_votes) {
                    await pool.query(`UPDATE duels SET total_votes = $1 WHERE id = $2`, [totalVotes, duel.id]);
                    console.log(`[endExpired] Updated stale vote count for duel ${duel.id}: DB=${duel.total_votes} → on-chain=${totalVotes}`);
                  }
                } catch (err: any) {
                  console.warn(`[endExpired] On-chain read failed for duel ${duel.id}, using DB count:`, err?.message);
                }
              }

              if (totalVotes >= MIN_VOTES_THRESHOLD) {
                const reward = computeReward(totalVotes, duel.staked_amount, avgVotes);
                const totalReturn = duel.staked_amount + reward;

                keeperResolveStake(duel.id, duel.staker_address, totalReturn).catch((err: any) =>
                  console.warn(`[endExpired] On-chain resolve_stake failed for duel ${duel.id}:`, err?.message),
                );

                await pool.query(
                  `UPDATE duels SET stake_status = 'rewarded', stake_reward = $1, stake_resolved_at = NOW() WHERE id = $2`,
                  [reward, duel.id],
                );
                await pool.query(
                  `INSERT INTO staking_log (duel_id, staker_address, amount, action, reward_amount) VALUES ($1, $2, $3, 'reward', $4)`,
                  [duel.id, duel.staker_address, duel.staked_amount, reward],
                );

                createNotification({
                  recipientAddress: duel.staker_address,
                  type: 'stake_resolved',
                  duelId: duel.id,
                  duelSlug: duel.slug,
                  duelTitle: duel.title,
                  message: `"${duel.title}" ended with ${totalVotes} votes — you earned +${reward} points`,
                  metadata: { staked: duel.staked_amount, reward, totalReturn, totalVotes },
                }).catch((err: any) => console.warn('[endExpired:notify] Failed:', err?.message));

                console.log(`[endExpired] Rewarded duel ${duel.id}: stake=${duel.staked_amount}, reward=${reward}`);
              } else {
                keeperBurnStake(duel.id).catch((err: any) =>
                  console.warn(`[endExpired] On-chain burn_stake failed for duel ${duel.id}:`, err?.message),
                );

                await pool.query(
                  `UPDATE duels SET stake_status = 'burned', queue_status = 'failed', stake_resolved_at = NOW() WHERE id = $1`,
                  [duel.id],
                );
                await pool.query(
                  `INSERT INTO staking_log (duel_id, staker_address, amount, action) VALUES ($1, $2, $3, 'burn')`,
                  [duel.id, duel.staker_address, duel.staked_amount],
                );

                createNotification({
                  recipientAddress: duel.staker_address,
                  type: 'stake_resolved',
                  duelId: duel.id,
                  duelSlug: duel.slug,
                  duelTitle: duel.title,
                  message: `"${duel.title}" ended with ${totalVotes} votes — your stake of ${duel.staked_amount} was burned`,
                  metadata: { staked: duel.staked_amount, burned: true, totalVotes },
                }).catch((err: any) => console.warn('[endExpired:notify] Failed:', err?.message));

                console.log(`[endExpired] Burned stake for duel ${duel.id}: stake=${duel.staked_amount}`);
              }
            } catch (err: any) {
              console.error(`[endExpired] Failed to resolve stake for duel ${duel.id}:`, err?.message);
            }
          }
        } catch (err: any) {
          console.error('[endExpired:staking] Error:', err?.message);
        }
      }

      // V9: Finalize duels on-chain for market voting auto-claim
      // Read fresh on-chain counts (DB may be up to 30s stale from cron sync)
      (async () => {
        try {
          const { keeperFinalizeDuel } = await import('./keeper/keeperFinalize.js');
          const { readDuelDirect, readOptionVoteCount, readLevelVoteCount } = await import('./aztec/publicStorageReader.js');
          const { getNode } = await import('./keeper/wallet.js');

          let node: any;
          let contractAddr: any;
          try {
            node = await getNode();
            contractAddr = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);
          } catch (err: any) {
            console.warn('[endExpired:finalize] Cannot connect to node, falling back to DB counts:', err?.message);
            node = null;
          }

          for (const duel of result.rows) {
            if (!duel.on_chain_id) continue;

            try {
              // Read fresh on-chain counts (source of truth for winner determination)
              let agreeCount = duel.agree_count;
              let disagreeCount = duel.disagree_count;

              if (node && contractAddr) {
                try {
                  const onChainData = await readDuelDirect(node, contractAddr, duel.on_chain_id);
                  if (onChainData.startBlock !== 0 || onChainData.endBlock !== 0) {
                    agreeCount = onChainData.agreeVotes;
                    disagreeCount = onChainData.disagreeVotes;
                    await pool.query(
                      `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
                      [agreeCount, disagreeCount, onChainData.totalVotes, duel.id],
                    );
                  }
                } catch (err: any) {
                  console.warn(`[endExpired:finalize] On-chain read failed for duel ${duel.id}, using DB counts:`, err?.message);
                }
              }

              if (duel.duel_type === 'binary') {
                const winning = agreeCount > disagreeCount ? 1 : 0;
                keeperFinalizeDuel(duel.on_chain_id, winning)
                  .then(() => pool.query(`UPDATE duels SET finalized_on_chain = TRUE WHERE id = $1`, [duel.id]))
                  .catch((err: any) =>
                    console.warn(`[endExpired:finalize] finalize_duel failed for duel ${duel.id}:`, err?.message),
                  );
                await pool.query(
                  `UPDATE duels SET winning_direction = $1, finalized_at = NOW() WHERE id = $2`,
                  [winning, duel.id],
                );
              } else {
                let maxVotes = 0;
                let winningIndex = 0;

                if (duel.duel_type === 'multi') {
                  const opts = await pool.query(
                    `SELECT id, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY id`,
                    [duel.id],
                  );
                  for (let i = 0; i < opts.rows.length; i++) {
                    let count = opts.rows[i].vote_count;
                    if (node && contractAddr) {
                      try { count = await readOptionVoteCount(node, contractAddr, duel.on_chain_id, i); } catch { /* DB fallback */ }
                    }
                    if (count > maxVotes) { maxVotes = count; winningIndex = i; }
                  }
                } else if (duel.duel_type === 'level') {
                  const lvls = await pool.query(
                    `SELECT level, vote_count FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
                    [duel.id],
                  );
                  for (const l of lvls.rows) {
                    let count = l.vote_count;
                    if (node && contractAddr) {
                      try { count = await readLevelVoteCount(node, contractAddr, duel.on_chain_id, l.level); } catch { /* DB fallback */ }
                    }
                    if (count > maxVotes) { maxVotes = count; winningIndex = l.level; }
                  }
                }

                keeperFinalizeDuel(duel.on_chain_id, winningIndex)
                  .then(() => pool.query(`UPDATE duels SET finalized_on_chain = TRUE WHERE id = $1`, [duel.id]))
                  .catch((err: any) =>
                    console.warn(`[endExpired:finalize] finalize_duel (multi/level) failed for duel ${duel.id}:`, err?.message),
                  );
                await pool.query(
                  `UPDATE duels SET winning_direction = $1, finalized_at = NOW() WHERE id = $2`,
                  [winningIndex, duel.id],
                );
              }
            } catch (err: any) {
              console.error(`[endExpired:finalize] Failed for duel ${duel.id}:`, err?.message);
            }
          }
        } catch (err: any) {
          console.warn('[endExpired:finalize] Error:', err?.message);
        }
      })();

      // Fire-and-forget: notify duel creators (skip staked duels — they already got a combined notification above)
      const stakedDuelIds = new Set(stakedDuels.map((d: any) => d.id));
      (async () => {
        try {
          const { createDuelEndNotification } = await import('./notifications/notificationService.js');
          for (const row of result.rows) {
            if (stakedDuelIds.has(row.id)) continue;
            const total = row.total_votes || 0;
            let msg: string;
            if (total === 0) {
              msg = `Your duel "${row.title}" has ended with no votes`;
            } else {
              msg = `Your duel "${row.title}" has ended with ${total} vote${total !== 1 ? 's' : ''}`;
            }
            await createDuelEndNotification(row.id, row.slug, row.title, msg, {
              agreeCount: row.agree_count,
              disagreeCount: row.disagree_count,
              totalVotes: total,
            }).catch((err: any) => console.warn('[snapshotCron:notify] Failed for duel', row.id, err?.message));
          }
        } catch (err: any) {
          console.warn('[snapshotCron:notify] Error:', err?.message);
        }
      })();
    }

    return count;
  } catch (err: any) {
    console.error('[snapshotCron:endExpired] Error:', err?.message);
    return 0;
  }
}

/**
 * Advance recurring duel periods. Creates new calendar-aligned period when current one ends.
 */
export async function advanceRecurringPeriods(): Promise<number> {
  try {
    // Find recurring duels where the latest period has ended
    const result = await pool.query(`
      SELECT d.id, d.recurrence, d.duel_type, d.title,
             dp.id AS period_id, dp.period_end
      FROM duels d
      JOIN duel_periods dp ON dp.duel_id = d.id
      WHERE d.status = 'active'
        AND d.timing_type = 'recurring'
        AND dp.period_end <= NOW()
        AND dp.status = 'active'
        AND dp.id = (SELECT MAX(id) FROM duel_periods WHERE duel_id = d.id)
    `);

    if (result.rows.length === 0) return 0;

    const { createDuelOnChain } = await import('./keeper/createDuelOnChain.js');
    const { getNode } = await import('./keeper/wallet.js');

    let advanced = 0;
    for (const row of result.rows) {
      try {
        // Mark old period as ended
        await pool.query(
          `UPDATE duel_periods SET status = 'ended' WHERE id = $1`,
          [row.period_id],
        );

        // Compute next calendar-aligned period
        const oldPeriodEnd = new Date(row.period_end);
        const { start: newStart, end: newEnd } = computeNextPeriod(row.recurrence, oldPeriodEnd);
        const slug = generatePeriodSlug(row.recurrence, newStart);

        // Compute endBlock
        let periodEndBlock: number | null = null;
        try {
          const node = await getNode();
          const currentBlock = await node.getBlockNumber();
          const clock = getBlockClock();
          const remainingSec = Math.max(0, (newEnd.getTime() - Date.now()) / 1000);
          periodEndBlock = currentBlock + Math.ceil(remainingSec / (clock.avgBlockTime || 30));
        } catch { /* will be set by pending cron */ }

        const periodResult = await pool.query(
          `INSERT INTO duel_periods (duel_id, period_start, period_end, slug, end_block, status)
           VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
          [row.id, newStart.toISOString(), newEnd.toISOString(), slug, periodEndBlock],
        );
        const periodId = periodResult.rows[0].id;

        // Per-period option votes for multi duels
        if (row.duel_type === 'multi') {
          const opts = await pool.query(
            `SELECT id FROM duel_options WHERE duel_id = $1 ORDER BY id`,
            [row.id],
          );
          for (const opt of opts.rows) {
            await pool.query(
              `INSERT INTO period_option_votes (period_id, option_id) VALUES ($1, $2)`,
              [periodId, opt.id],
            );
          }
        }

        // Per-period level votes for level duels
        if (row.duel_type === 'level') {
          const lvls = await pool.query(
            `SELECT level FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
            [row.id],
          );
          for (const lvl of lvls.rows) {
            await pool.query(
              `INSERT INTO period_level_votes (period_id, duel_id, level) VALUES ($1, $2, $3)`,
              [periodId, row.id, lvl.level],
            );
          }
        }

        // Fire-and-forget on-chain creation for this period
        if (periodEndBlock) {
          (async () => {
            try {
              const onChainId = await createDuelOnChain(row.title, periodEndBlock!);
              await pool.query(
                `UPDATE duel_periods SET on_chain_id = $1 WHERE id = $2`,
                [onChainId, periodId],
              );
              console.log(`[snapshotCron:advance] On-chain period created: periodId=${periodId} onChainId=${onChainId}`);
            } catch (err: any) {
              console.error(`[snapshotCron:advance] On-chain creation failed for periodId=${periodId}:`, err?.message);
            }
          })();
        }

        advanced++;
      } catch (err: any) {
        console.error(`[snapshotCron:advancePeriods] Failed for duelId=${row.id}:`, err?.message);
      }
    }

    return advanced;
  } catch (err: any) {
    console.error('[snapshotCron:advancePeriods] Error:', err?.message);
    return 0;
  }
}

/**
 * Safety net: create on-chain duels for any active duels that are missing on_chain_id.
 * Catches failures from the inline fire-and-forget in POST /api/duels.
 */
export async function processPendingOnChainDuels(): Promise<number> {
  try {
    const result = await pool.query(`
      SELECT d.id, d.title, d.timing_type, d.ends_at, d.duration_seconds, d.recurrence
      FROM duels d
      WHERE d.status = 'active' AND d.on_chain_id IS NULL AND d.timing_type != 'recurring'
      LIMIT 5
    `);

    // Also check for pending period on-chain IDs
    const periodResult = await pool.query(`
      SELECT dp.id, dp.period_end, dp.end_block, d.title
      FROM duel_periods dp
      JOIN duels d ON d.id = dp.duel_id
      WHERE dp.on_chain_id IS NULL AND dp.status = 'active' AND d.status = 'active'
      LIMIT 5
    `);

    if (result.rows.length === 0 && periodResult.rows.length === 0) return 0;

    const { createDuelOnChain } = await import('./keeper/createDuelOnChain.js');
    const { getNode } = await import('./keeper/wallet.js');
    const node = await getNode();
    const currentBlock = await node.getBlockNumber();
    const clock = getBlockClock();
    const avgBlockTime = clock.avgBlockTime || 30;

    let created = 0;

    // Non-recurring duels missing on_chain_id
    for (const row of result.rows) {
      try {
        let endBlock: number;
        if (row.ends_at) {
          const endsAtMs = new Date(row.ends_at).getTime();
          const remainingSeconds = Math.max(0, (endsAtMs - Date.now()) / 1000);
          endBlock = currentBlock + Math.ceil(remainingSeconds / avgBlockTime);
        } else {
          endBlock = 4294967295; // u32::MAX
        }

        const onChainId = await createDuelOnChain(row.title, endBlock);
        await pool.query(
          `UPDATE duels SET on_chain_id = $1, end_block = COALESCE(end_block, $2) WHERE id = $3`,
          [onChainId, endBlock, row.id],
        );
        console.log(`[snapshotCron:pending] On-chain duel created: dbId=${row.id} onChainId=${onChainId} endBlock=${endBlock}`);
        created++;
      } catch (err: any) {
        console.error(`[snapshotCron:pending] Failed for duelId=${row.id}:`, err?.message);
      }
    }

    // Recurring periods missing on_chain_id (query already executed above)
    for (const row of periodResult.rows) {
      try {
        let endBlock = row.end_block;
        if (!endBlock) {
          const remainingSec = Math.max(0, (new Date(row.period_end).getTime() - Date.now()) / 1000);
          endBlock = currentBlock + Math.ceil(remainingSec / avgBlockTime);
        }

        const onChainId = await createDuelOnChain(row.title, endBlock);
        await pool.query(
          `UPDATE duel_periods SET on_chain_id = $1, end_block = COALESCE(end_block, $2) WHERE id = $3`,
          [onChainId, endBlock, row.id],
        );
        console.log(`[snapshotCron:pending] On-chain period created: periodId=${row.id} onChainId=${onChainId}`);
        created++;
      } catch (err: any) {
        console.error(`[snapshotCron:pending] Failed for periodId=${row.id}:`, err?.message);
      }
    }

    return created;
  } catch (err: any) {
    console.error('[snapshotCron:pending] Error:', err?.message);
    return 0;
  }
}

/**
 * Sync on-chain vote tallies to DB for active duels with on_chain_id.
 * Reads aggregate public data (no per-voter info) from L2 storage.
 */
/** Simple concurrency limiter (avoids adding p-limit dependency) */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length > 0) queue.shift()!();
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

export async function syncOnChainTallies(): Promise<number> {
  try {
    const result = await pool.query(`
      SELECT d.id, d.on_chain_id, d.duel_type
      FROM duels d
      WHERE d.status = 'active' AND d.on_chain_id IS NOT NULL
    `);

    if (result.rows.length === 0) return 0;

    const { readDuelDirect, readDuelCount, readOptionVoteCount, readLevelVoteCount } = await import('./aztec/publicStorageReader.js');
    const { getNode } = await import('./keeper/wallet.js');
    const { getHighestAssignedId } = await import('./keeper/createDuelOnChain.js');
    const node = await getNode();
    const contractAddr = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);

    // Guard: check how many duels exist on-chain to skip stale IDs from previous deploys.
    // Use max of: (a) on-chain count, (b) locally assigned IDs from this process,
    // (c) highest ID in DB (survives restarts). NO_WAIT means on-chain lags behind.
    const onChainDuelCount = await readDuelCount(node, contractAddr);
    const highestAssigned = getHighestAssignedId();
    const dbMaxResult = await pool.query(`
      SELECT GREATEST(
        COALESCE((SELECT MAX(on_chain_id) FROM duels), 0),
        COALESCE((SELECT MAX(on_chain_id) FROM duel_periods), 0)
      ) AS max_id
    `);
    const dbMaxId = Number(dbMaxResult.rows[0]?.max_id || 0);
    const maxValidId = Math.max(
      onChainDuelCount,
      highestAssigned ?? 0,
      dbMaxId,
    );

    // Batch: fetch all option rows for active multi duels with on_chain_id
    const allOpts = await pool.query(`
      SELECT do2.duel_id, do2.id, do2.vote_count
      FROM duel_options do2
      JOIN duels d ON d.id = do2.duel_id
      WHERE d.status = 'active' AND d.on_chain_id IS NOT NULL AND d.duel_type = 'multi'
      ORDER BY do2.id
    `);
    const optsByDuel = new Map<number, Array<{id: number; vote_count: number}>>();
    for (const o of allOpts.rows) {
      if (!optsByDuel.has(o.duel_id)) optsByDuel.set(o.duel_id, []);
      optsByDuel.get(o.duel_id)!.push({ id: o.id, vote_count: o.vote_count });
    }

    // Batch: fetch all level rows for active level duels with on_chain_id
    const allLvls = await pool.query(`
      SELECT dl.duel_id, dl.level, dl.vote_count
      FROM duel_levels dl
      JOIN duels d ON d.id = dl.duel_id
      WHERE d.status = 'active' AND d.on_chain_id IS NOT NULL AND d.duel_type = 'level'
      ORDER BY dl.level
    `);
    const lvlsByDuel = new Map<number, Array<{level: number; vote_count: number}>>();
    for (const l of allLvls.rows) {
      if (!lvlsByDuel.has(l.duel_id)) lvlsByDuel.set(l.duel_id, []);
      lvlsByDuel.get(l.duel_id)!.push({ level: l.level, vote_count: l.vote_count });
    }

    // Concurrency limiter for RPC reads (devnet can't handle >12 parallel requests)
    const limit = pLimit(5);

    let synced = 0;
    for (const row of result.rows) {
      try {
        if (row.on_chain_id > maxValidId) {
          // Stale on_chain_id from a previous contract deploy — clear it
          console.warn(`[snapshotCron:syncTallies] Stale on_chain_id=${row.on_chain_id} for duelId=${row.id} (onChain=${onChainDuelCount}, localMax=${highestAssigned}). Clearing.`);
          await pool.query(`UPDATE duels SET on_chain_id = NULL WHERE id = $1`, [row.id]);
          continue;
        }

        const onChainData = await readDuelDirect(node, contractAddr, row.on_chain_id);

        // Skip if duel hasn't been mined yet (NO_WAIT window — storage reads as all zeros)
        if (onChainData.endBlock === 0 && onChainData.startBlock === 0) {
          continue;
        }

        // Never go backwards on vote counts (stale on-chain read during NO_WAIT window)
        const currentTotal = await pool.query(`SELECT total_votes FROM duels WHERE id = $1`, [row.id]);
        const dbTotal = currentTotal.rows[0]?.total_votes ?? 0;
        if (onChainData.totalVotes < dbTotal) {
          continue;
        }

        await pool.query(
          `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
          [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, row.id],
        );

        // Sync per-option vote counts for multi duels
        if (row.duel_type === 'multi') {
          const opts = optsByDuel.get(row.id) || [];
          const optionPromises = opts.map((_, i) =>
            limit(() => readOptionVoteCount(node, contractAddr, row.on_chain_id, i).catch((err: any) => {
              console.warn(`[syncTallies] duelId=${row.id} option ${i} read failed:`, err?.message);
              return null;
            }))
          );
          const optionCounts = await Promise.all(optionPromises);

          for (let i = 0; i < opts.length; i++) {
            if (optionCounts[i] !== null) {
              console.log(`[syncTallies] duelId=${row.id} option ${i}: onChain=${optionCounts[i]}, db=${opts[i].vote_count}`);
            }
          }

          // Batch update changed options
          const optUpdates: Array<[number, number]> = [];
          for (let i = 0; i < opts.length; i++) {
            if (optionCounts[i] !== null && optionCounts[i] !== opts[i].vote_count) {
              optUpdates.push([optionCounts[i]!, opts[i].id]);
            }
          }
          if (optUpdates.length > 0) {
            await pool.query(
              `UPDATE duel_options SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS id) u WHERE duel_options.id = u.id`,
              [optUpdates.map(u => u[0]), optUpdates.map(u => u[1])],
            );
          }
        }

        // Sync per-level vote counts for level duels
        if (row.duel_type === 'level') {
          const lvls = lvlsByDuel.get(row.id) || [];
          const levelPromises = lvls.map(lvl =>
            limit(() => readLevelVoteCount(node, contractAddr, row.on_chain_id, lvl.level).catch(() => null))
          );
          const levelCounts = await Promise.all(levelPromises);

          // Batch update changed levels
          const lvlUpdates: Array<[number, number, number]> = []; // [count, duel_id, level]
          for (let i = 0; i < lvls.length; i++) {
            if (levelCounts[i] !== null && levelCounts[i] !== lvls[i].vote_count) {
              lvlUpdates.push([levelCounts[i]!, row.id, lvls[i].level]);
            }
          }
          if (lvlUpdates.length > 0) {
            await pool.query(
              `UPDATE duel_levels SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS duel_id, unnest($3::int[]) AS level) u WHERE duel_levels.duel_id = u.duel_id AND duel_levels.level = u.level`,
              [lvlUpdates.map(u => u[0]), lvlUpdates.map(u => u[1]), lvlUpdates.map(u => u[2])],
            );
          }
        }

        synced++;
      } catch (err: any) {
        // Non-fatal: individual duel sync failure shouldn't stop others
        console.warn(`[snapshotCron:syncTallies] Failed for duelId=${row.id}:`, err?.message);
      }
    }

    // Period-level sync for recurring duels
    const periodResult = await pool.query(`
      SELECT dp.id AS period_id, dp.on_chain_id, dp.duel_id, d.duel_type
      FROM duel_periods dp
      JOIN duels d ON d.id = dp.duel_id
      WHERE dp.status = 'active' AND dp.on_chain_id IS NOT NULL
    `);

    // Batch: fetch all period option votes for active periods
    const allPeriodOpts = await pool.query(`
      SELECT pov.period_id, pov.option_id, pov.vote_count, do2.id AS duel_option_id
      FROM period_option_votes pov
      JOIN duel_options do2 ON do2.id = pov.option_id
      JOIN duel_periods dp ON dp.id = pov.period_id
      WHERE dp.status = 'active' AND dp.on_chain_id IS NOT NULL
      ORDER BY do2.id
    `);
    const periodOptsByPeriod = new Map<number, Array<{option_id: number; vote_count: number; duel_option_id: number}>>();
    for (const po of allPeriodOpts.rows) {
      if (!periodOptsByPeriod.has(po.period_id)) periodOptsByPeriod.set(po.period_id, []);
      periodOptsByPeriod.get(po.period_id)!.push({ option_id: po.option_id, vote_count: po.vote_count, duel_option_id: po.duel_option_id });
    }

    // Batch: fetch all period level votes for active periods
    const allPeriodLvls = await pool.query(`
      SELECT plv.period_id, plv.duel_id, plv.level, plv.vote_count
      FROM period_level_votes plv
      JOIN duel_periods dp ON dp.id = plv.period_id
      WHERE dp.status = 'active' AND dp.on_chain_id IS NOT NULL
      ORDER BY plv.level
    `);
    const periodLvlsByPeriod = new Map<number, Array<{duel_id: number; level: number; vote_count: number}>>();
    for (const pl of allPeriodLvls.rows) {
      if (!periodLvlsByPeriod.has(pl.period_id)) periodLvlsByPeriod.set(pl.period_id, []);
      periodLvlsByPeriod.get(pl.period_id)!.push({ duel_id: pl.duel_id, level: pl.level, vote_count: pl.vote_count });
    }

    for (const pRow of periodResult.rows) {
      try {
        if (pRow.on_chain_id > maxValidId) {
          console.warn(`[snapshotCron:syncTallies] Stale period on_chain_id=${pRow.on_chain_id} for periodId=${pRow.period_id} (onChain=${onChainDuelCount}, localMax=${highestAssigned}). Clearing.`);
          await pool.query(`UPDATE duel_periods SET on_chain_id = NULL WHERE id = $1`, [pRow.period_id]);
          continue;
        }

        const onChainData = await readDuelDirect(node, contractAddr, pRow.on_chain_id);

        // Skip if duel hasn't been mined yet (NO_WAIT window)
        if (onChainData.endBlock === 0 && onChainData.startBlock === 0) {
          continue;
        }

        // Update period tallies
        await pool.query(
          `UPDATE duel_periods SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
          [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, pRow.period_id],
        );

        // Also update parent duel counts to match active period (for feed display)
        await pool.query(
          `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
          [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, pRow.duel_id],
        );

        // Sync per-option vote counts for multi duels
        if (pRow.duel_type === 'multi') {
          const creationOrder = periodOptsByPeriod.get(pRow.period_id) || [];
          const optionPromises = creationOrder.map((_, i) =>
            limit(() => readOptionVoteCount(node, contractAddr, pRow.on_chain_id, i).catch((err: any) => {
              console.warn(`[syncTallies] period=${pRow.period_id} option ${i} read failed:`, err?.message);
              return null;
            }))
          );
          const optionCounts = await Promise.all(optionPromises);

          // Batch update period_option_votes
          const povUpdates: Array<[number, number, number]> = []; // [count, period_id, option_id]
          const parentOptUpdates: Array<[number, number]> = []; // [count, option_id]
          for (let i = 0; i < creationOrder.length; i++) {
            if (optionCounts[i] !== null) {
              if (optionCounts[i] !== creationOrder[i].vote_count) {
                povUpdates.push([optionCounts[i]!, pRow.period_id, creationOrder[i].option_id]);
              }
              // Always update parent duel_options (feed reads from duel_options)
              parentOptUpdates.push([optionCounts[i]!, creationOrder[i].option_id]);
            }
          }
          if (povUpdates.length > 0) {
            await pool.query(
              `UPDATE period_option_votes SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS period_id, unnest($3::int[]) AS option_id) u WHERE period_option_votes.period_id = u.period_id AND period_option_votes.option_id = u.option_id`,
              [povUpdates.map(u => u[0]), povUpdates.map(u => u[1]), povUpdates.map(u => u[2])],
            );
          }
          if (parentOptUpdates.length > 0) {
            await pool.query(
              `UPDATE duel_options SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS id) u WHERE duel_options.id = u.id`,
              [parentOptUpdates.map(u => u[0]), parentOptUpdates.map(u => u[1])],
            );
          }
        }

        // Sync per-level vote counts for level duels
        if (pRow.duel_type === 'level') {
          const lvls = periodLvlsByPeriod.get(pRow.period_id) || [];
          const levelPromises = lvls.map(lvl =>
            limit(() => readLevelVoteCount(node, contractAddr, pRow.on_chain_id, lvl.level).catch((err: any) => {
              console.warn(`[syncTallies] period=${pRow.period_id} level ${lvl.level} read failed:`, err?.message);
              return null;
            }))
          );
          const levelCounts = await Promise.all(levelPromises);

          // Batch update period_level_votes
          const plvUpdates: Array<[number, number, number, number]> = []; // [count, period_id, duel_id, level]
          const parentLvlUpdates: Array<[number, number, number]> = []; // [count, duel_id, level]
          for (let i = 0; i < lvls.length; i++) {
            if (levelCounts[i] !== null) {
              if (levelCounts[i] !== lvls[i].vote_count) {
                plvUpdates.push([levelCounts[i]!, pRow.period_id, pRow.duel_id, lvls[i].level]);
              }
              // Always update parent duel_levels (feed reads from duel_levels)
              parentLvlUpdates.push([levelCounts[i]!, pRow.duel_id, lvls[i].level]);
            }
          }
          if (plvUpdates.length > 0) {
            await pool.query(
              `UPDATE period_level_votes SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS period_id, unnest($3::int[]) AS duel_id, unnest($4::int[]) AS level) u WHERE period_level_votes.period_id = u.period_id AND period_level_votes.duel_id = u.duel_id AND period_level_votes.level = u.level`,
              [plvUpdates.map(u => u[0]), plvUpdates.map(u => u[1]), plvUpdates.map(u => u[2]), plvUpdates.map(u => u[3])],
            );
          }
          if (parentLvlUpdates.length > 0) {
            await pool.query(
              `UPDATE duel_levels SET vote_count = u.count FROM (SELECT unnest($1::int[]) AS count, unnest($2::int[]) AS duel_id, unnest($3::int[]) AS level) u WHERE duel_levels.duel_id = u.duel_id AND duel_levels.level = u.level`,
              [parentLvlUpdates.map(u => u[0]), parentLvlUpdates.map(u => u[1]), parentLvlUpdates.map(u => u[2])],
            );
          }
        }

        synced++;
      } catch (err: any) {
        console.warn(`[snapshotCron:syncTallies] Failed for periodId=${pRow.period_id}:`, err?.message);
      }
    }

    return synced;
  } catch (err: any) {
    console.error('[snapshotCron:syncTallies] Error:', err?.message);
    return 0;
  }
}

/**
 * Retry on-chain finalization for duels where the keeper call failed.
 * Finds duels that have finalized_at (winner determined) but finalized_on_chain = false.
 */
export async function retryFailedFinalizations(): Promise<number> {
  try {
    const result = await pool.query(`
      SELECT id, on_chain_id, winning_direction
      FROM duels
      WHERE finalized_at IS NOT NULL
        AND finalized_on_chain = FALSE
        AND on_chain_id IS NOT NULL
        AND winning_direction IS NOT NULL
      LIMIT 5
    `);

    if (result.rows.length === 0) return 0;

    const { keeperFinalizeDuel } = await import('./keeper/keeperFinalize.js');
    let retried = 0;

    for (const duel of result.rows) {
      try {
        await keeperFinalizeDuel(duel.on_chain_id, duel.winning_direction);
        await pool.query(
          `UPDATE duels SET finalized_on_chain = TRUE WHERE id = $1`,
          [duel.id],
        );
        console.log(`[retryFinalize] Successfully finalized duel ${duel.id} on-chain`);
        retried++;
      } catch (err: any) {
        console.warn(`[retryFinalize] Failed for duel ${duel.id}:`, err?.message);
      }
    }

    return retried;
  } catch (err: any) {
    console.error('[retryFinalize] Error:', err?.message);
    return 0;
  }
}

/**
 * Monitor block time drift for active duels.
 * Compares expected end time (based on end_block * avgBlockTime) against ends_at.
 * Logs warnings when drift exceeds 10%.
 */
export async function monitorBlockDrift(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT id, slug, end_block, ends_at
      FROM duels
      WHERE status = 'active' AND end_block IS NOT NULL AND ends_at IS NOT NULL
    `);

    if (result.rows.length === 0) return;

    const { getNode } = await import('./keeper/wallet.js');
    const node = await getNode();
    const currentBlock = await node.getBlockNumber();
    const clock = getBlockClock();
    const avgBlockTime = clock.avgBlockTime || 30;

    for (const duel of result.rows) {
      const blocksRemaining = duel.end_block - currentBlock;
      if (blocksRemaining <= 0) continue;

      const expectedEndMs = Date.now() + blocksRemaining * avgBlockTime * 1000;
      const actualEndMs = new Date(duel.ends_at).getTime();
      const driftMs = Math.abs(expectedEndMs - actualEndMs);
      const durationMs = actualEndMs - Date.now();

      if (durationMs > 0 && driftMs / durationMs > 0.1) {
        const driftMin = (driftMs / 60000).toFixed(1);
        const direction = expectedEndMs > actualEndMs ? 'late' : 'early';
        console.warn(
          `[blockDrift] Duel ${duel.id} (${duel.slug}): on-chain will end ~${driftMin}min ${direction} vs DB ends_at (drift ${((driftMs / durationMs) * 100).toFixed(0)}%)`,
        );
      }
    }
  } catch (err: any) {
    console.warn('[blockDrift] Monitor failed:', err?.message);
  }
}
