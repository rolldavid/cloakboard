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
    // Get all active duels with their latest snapshot time
    const result = await pool.query(`
      SELECT d.id, d.agree_count, d.disagree_count, d.total_votes, d.duel_type,
             MAX(vs.snapshot_at) AS last_snapshot
      FROM duels d
      LEFT JOIN vote_snapshots vs ON vs.duel_id = d.id
      WHERE d.status = 'active'
      GROUP BY d.id
    `);

    let inserted = 0;
    const now = new Date();

    for (const row of result.rows) {
      const lastSnapshot = row.last_snapshot ? new Date(row.last_snapshot) : null;

      // Skip if snapshot was taken recently
      if (lastSnapshot && now.getTime() - lastSnapshot.getTime() < SNAPSHOT_INTERVAL_MS) {
        continue;
      }

      // For multi/level duels, include option/level counts as JSONB
      let optionCounts: any = null;

      if (row.duel_type === 'multi') {
        const opts = await pool.query(
          `SELECT id, vote_count FROM duel_options WHERE duel_id = $1`,
          [row.id],
        );
        optionCounts = {};
        for (const o of opts.rows) {
          optionCounts[o.id] = o.vote_count;
        }
      } else if (row.duel_type === 'level') {
        const lvls = await pool.query(
          `SELECT level, vote_count FROM duel_levels WHERE duel_id = $1`,
          [row.id],
        );
        optionCounts = {};
        for (const l of lvls.rows) {
          optionCounts[l.level] = l.vote_count;
        }
      }

      // For recurring duels, find active period and use period-level counts
      let periodId: number | null = null;
      let snapshotAgree = row.agree_count;
      let snapshotDisagree = row.disagree_count;
      let snapshotTotal = row.total_votes;

      const periodCheck = await pool.query(
        `SELECT dp.id, dp.agree_count, dp.disagree_count, dp.total_votes
         FROM duel_periods dp
         WHERE dp.duel_id = $1 AND dp.status = 'active'
         ORDER BY dp.id DESC LIMIT 1`,
        [row.id],
      );
      if (periodCheck.rows.length > 0) {
        const p = periodCheck.rows[0];
        periodId = p.id;
        snapshotAgree = p.agree_count;
        snapshotDisagree = p.disagree_count;
        snapshotTotal = p.total_votes;

        // Use period-level option/level counts
        if (row.duel_type === 'multi') {
          const povs = await pool.query(
            `SELECT option_id, vote_count FROM period_option_votes WHERE period_id = $1`,
            [periodId],
          );
          optionCounts = {};
          for (const pov of povs.rows) {
            optionCounts[pov.option_id] = pov.vote_count;
          }
        } else if (row.duel_type === 'level') {
          const plvs = await pool.query(
            `SELECT level, vote_count FROM period_level_votes WHERE period_id = $1 AND duel_id = $2`,
            [periodId, row.id],
          );
          optionCounts = {};
          for (const plv of plvs.rows) {
            optionCounts[plv.level] = plv.vote_count;
          }
        }
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
    const result = await pool.query(`
      UPDATE duels SET status = 'ended'
      WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= NOW()
      RETURNING id
    `);
    return result.rowCount || 0;
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
    const node = await getNode();
    const contractAddr = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);

    // Guard: check how many duels exist on-chain to skip stale IDs from previous deploys
    const onChainDuelCount = await readDuelCount(node, contractAddr);

    let synced = 0;
    for (const row of result.rows) {
      try {
        if (row.on_chain_id > onChainDuelCount) {
          // Stale on_chain_id from a previous contract deploy — clear it
          // Note: uses > (not >=) because createDuelOnChain returns duel_count as the new ID
          // before the tx is mined (NO_WAIT). During mining window, on_chain_id === duel_count is valid.
          console.warn(`[snapshotCron:syncTallies] Stale on_chain_id=${row.on_chain_id} for duelId=${row.id} (contract has ${onChainDuelCount} duels). Clearing.`);
          await pool.query(`UPDATE duels SET on_chain_id = NULL WHERE id = $1`, [row.id]);
          continue;
        }

        const onChainData = await readDuelDirect(node, contractAddr, row.on_chain_id);

        // Skip if duel hasn't been mined yet (NO_WAIT window — storage reads as all zeros)
        if (onChainData.endBlock === 0 && onChainData.startBlock === 0) {
          continue;
        }

        await pool.query(
          `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
          [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, row.id],
        );

        // Sync per-option vote counts for multi duels
        if (row.duel_type === 'multi') {
          const opts = await pool.query(
            `SELECT id, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY id`,
            [row.id],
          );
          for (let i = 0; i < opts.rows.length; i++) {
            try {
              const onChainCount = await readOptionVoteCount(node, contractAddr, row.on_chain_id, i);
              console.log(`[syncTallies] duelId=${row.id} option ${i}: onChain=${onChainCount}, db=${opts.rows[i].vote_count}`);
              if (onChainCount !== opts.rows[i].vote_count) {
                await pool.query(
                  `UPDATE duel_options SET vote_count = $1 WHERE id = $2`,
                  [onChainCount, opts.rows[i].id],
                );
              }
            } catch (err: any) {
              console.warn(`[syncTallies] duelId=${row.id} option ${i} read failed:`, err?.message);
            }
          }
        }

        // Sync per-level vote counts for level duels
        if (row.duel_type === 'level') {
          const lvls = await pool.query(
            `SELECT level, vote_count FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
            [row.id],
          );
          for (const lvl of lvls.rows) {
            try {
              const onChainCount = await readLevelVoteCount(node, contractAddr, row.on_chain_id, lvl.level);
              if (onChainCount !== lvl.vote_count) {
                await pool.query(
                  `UPDATE duel_levels SET vote_count = $1 WHERE duel_id = $2 AND level = $3`,
                  [onChainCount, row.id, lvl.level],
                );
              }
            } catch { /* individual level read failure — non-fatal */ }
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

    for (const pRow of periodResult.rows) {
      try {
        if (pRow.on_chain_id > onChainDuelCount) {
          console.warn(`[snapshotCron:syncTallies] Stale period on_chain_id=${pRow.on_chain_id} for periodId=${pRow.period_id}. Clearing.`);
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
          const opts = await pool.query(
            `SELECT pov.option_id, pov.vote_count, do2.id AS duel_option_id
             FROM period_option_votes pov
             JOIN duel_options do2 ON do2.id = pov.option_id
             WHERE pov.period_id = $1
             ORDER BY do2.id`,
            [pRow.period_id],
          );
          const creationOrder = opts.rows;
          for (let i = 0; i < creationOrder.length; i++) {
            try {
              const onChainCount = await readOptionVoteCount(node, contractAddr, pRow.on_chain_id, i);
              if (onChainCount !== creationOrder[i].vote_count) {
                await pool.query(
                  `UPDATE period_option_votes SET vote_count = $1 WHERE period_id = $2 AND option_id = $3`,
                  [onChainCount, pRow.period_id, creationOrder[i].option_id],
                );
              }
              // Also update parent duel_options (feed reads from duel_options, not period_option_votes)
              await pool.query(
                `UPDATE duel_options SET vote_count = $1 WHERE id = $2`,
                [onChainCount, creationOrder[i].option_id],
              );
            } catch (err: any) {
              console.warn(`[syncTallies] period=${pRow.period_id} option ${i} read failed:`, err?.message);
            }
          }
        }

        // Sync per-level vote counts for level duels
        if (pRow.duel_type === 'level') {
          const lvls = await pool.query(
            `SELECT level, vote_count FROM period_level_votes WHERE period_id = $1 AND duel_id = $2 ORDER BY level`,
            [pRow.period_id, pRow.duel_id],
          );
          for (const lvl of lvls.rows) {
            try {
              const onChainCount = await readLevelVoteCount(node, contractAddr, pRow.on_chain_id, lvl.level);
              if (onChainCount !== lvl.vote_count) {
                await pool.query(
                  `UPDATE period_level_votes SET vote_count = $1 WHERE period_id = $2 AND duel_id = $3 AND level = $4`,
                  [onChainCount, pRow.period_id, pRow.duel_id, lvl.level],
                );
              }
              // Also update parent duel_levels (feed reads from duel_levels)
              await pool.query(
                `UPDATE duel_levels SET vote_count = $1 WHERE duel_id = $2 AND level = $3`,
                [onChainCount, pRow.duel_id, lvl.level],
              );
            } catch (err: any) {
              console.warn(`[syncTallies] period=${pRow.period_id} level ${lvl.level} read failed:`, err?.message);
            }
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
