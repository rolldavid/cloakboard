/**
 * GET /api/keeper/cron
 *
 * Keeper Cron:
 * 1. Check duel_schedule for auto-advance — calls advance-duel for due cloaks
 * 2. Backfill missing duel_snapshots from on-chain state
 * 3. Sync vote counts from on-chain state into duel_snapshots
 *
 * V4: Uses direct public storage reads (no PXE simulation, no artifact loading).
 */

import { Router, type Request, type Response } from 'express';
import { getDueCloaks } from '../lib/db/duelSchedule';
import { getAvailableStatementCount } from '../lib/db/statements';
import { pool } from '../lib/db/pool.js';
import { getNode } from '../lib/keeper/wallet';
import { getKeeperStore } from '../lib/keeper/store';
import { maybeInsertSnapshot } from '../lib/db/voteTimeline';
import { upsertDuelSnapshot } from '../lib/db/duelSnapshotSync';
import { readDuelDirect, readDuelCount } from '../lib/aztec/publicStorageReader.js';

const router = Router();

interface CloakResult {
  cloakAddress: string;
  action: string;
  status: 'success' | 'skipped' | 'error';
  reason?: string;
}

/** Decode 4 bigint Field parts back into a UTF-8 string (reverse of textToFieldParts). */
function fieldPartsToText(p1: bigint, p2: bigint, p3: bigint, p4: bigint): string {
  const parts = [p1, p2, p3, p4];
  const bytes = new Uint8Array(124);
  for (let i = 0; i < 4; i++) {
    let value = parts[i];
    for (let j = 30; j >= 0; j--) {
      bytes[i * 31 + j] = Number(value & 0xFFn);
      value >>= 8n;
    }
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes).replace(/\0/g, '').trim();
}

/** Backfill missing duel_snapshots by comparing on-chain duel_count with DB rows. */
async function backfillMissingDuels(results: CloakResult[]): Promise<void> {
  const store = getKeeperStore();
  const entries = await store.list();
  if (entries.length === 0) return;

  let node: any;
  try {
    node = await getNode();
  } catch {
    return;
  }

  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  for (const entry of entries) {
    try {
      const cloakAddr = AztecAddress.fromString(entry.cloakAddress);

      // Read on-chain duel count
      let onChainCount: number;
      try {
        onChainCount = await readDuelCount(node, cloakAddr);
      } catch {
        continue; // Contract may not be deployed yet
      }

      if (onChainCount === 0) continue;

      // Get existing snapshot IDs from DB
      const { rows: existingRows } = await pool.query(
        `SELECT duel_id FROM duel_snapshots WHERE cloak_address = $1 ORDER BY duel_id`,
        [entry.cloakAddress],
      );
      const existingIds = new Set(existingRows.map((r: any) => r.duel_id));

      // Find missing duel IDs
      const missingIds: number[] = [];
      for (let i = 0; i < onChainCount; i++) {
        if (!existingIds.has(i)) missingIds.push(i);
      }

      if (missingIds.length === 0) continue;

      console.log(`[Keeper Cron] Backfilling ${missingIds.length} missing duel(s) for ${entry.cloakAddress.slice(0, 14)}...`);

      for (const duelId of missingIds) {
        try {
          const duelData = await readDuelDirect(node, cloakAddr, duelId);
          const statementText = fieldPartsToText(
            duelData.statementPart1, duelData.statementPart2,
            duelData.statementPart3, duelData.statementPart4,
          );

          await upsertDuelSnapshot({
            cloakAddress: entry.cloakAddress,
            cloakName: entry.cloakName || '',
            cloakSlug: entry.cloakSlug || '',
            duelId,
            statementText,
            startBlock: duelData.startBlock,
            endBlock: duelData.endBlock,
            totalVotes: duelData.totalVotes,
            agreeVotes: duelData.agreeVotes,
            disagreeVotes: duelData.disagreeVotes,
            isTallied: duelData.isTallied,
          });

          console.log(`[Keeper Cron] Backfilled duel #${duelId} for ${entry.cloakAddress.slice(0, 14)}...`);
          results.push({ cloakAddress: entry.cloakAddress, action: `backfill_duel_${duelId}`, status: 'success' });
        } catch (err: any) {
          console.warn(`[Keeper Cron] Backfill duel #${duelId} failed: ${err?.message}`);
          results.push({ cloakAddress: entry.cloakAddress, action: `backfill_duel_${duelId}`, status: 'error', reason: err?.message });
        }
      }
    } catch (err: any) {
      results.push({ cloakAddress: entry.cloakAddress, action: 'backfill', status: 'error', reason: err?.message });
    }
  }
}

/** Sync on-chain vote counts into duel_snapshots for active duels.
 *  Returns addresses of cloaks whose duels just concluded (newly tallied). */
async function syncVoteCounts(results: CloakResult[]): Promise<string[]> {
  const { rows: activeDuels } = await pool.query(
    `SELECT cloak_address, duel_id FROM duel_snapshots WHERE is_tallied = false`,
  );
  if (activeDuels.length === 0) return [];

  let node: any;
  try {
    node = await getNode();
  } catch {
    // Node not available — skip sync silently
    return [];
  }

  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  const newlyConcluded: string[] = [];

  for (const row of activeDuels) {
    try {
      const cloakAddr = AztecAddress.fromString(row.cloak_address);
      const duelData = await readDuelDirect(node, cloakAddr, row.duel_id);

      const totalVotes = duelData.totalVotes;
      const agreeVotes = duelData.agreeVotes;
      const disagreeVotes = duelData.disagreeVotes;
      const isTallied = duelData.isTallied;
      const startBlock = duelData.startBlock;
      const endBlock = duelData.endBlock;

      // Detect if duel just concluded (end_block passed)
      let justConcluded = false;
      if (!isTallied && endBlock > 0) {
        try {
          const blockNumber = await node.getBlockNumber();
          if (blockNumber > endBlock) justConcluded = true;
        } catch { /* can't check block — skip */ }
      }
      if (isTallied) justConcluded = true;

      await pool.query(
        `UPDATE duel_snapshots
         SET total_votes = $1, agree_votes = $2, disagree_votes = $3, is_tallied = $4,
             start_block = CASE WHEN $7 > 0 THEN $7 ELSE start_block END,
             end_block = CASE WHEN $8 > 0 THEN $8 ELSE end_block END,
             updated_at = NOW()
         WHERE cloak_address = $5 AND duel_id = $6`,
        [totalVotes, agreeVotes, disagreeVotes, justConcluded || isTallied, row.cloak_address, row.duel_id, startBlock, endBlock],
      );

      // Insert timeline snapshot for chart
      const snapRow = await pool.query(
        `SELECT created_at FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
        [row.cloak_address, row.duel_id],
      );
      const createdAt = snapRow.rows[0]?.created_at ? new Date(snapRow.rows[0].created_at) : new Date();
      await maybeInsertSnapshot(row.cloak_address, row.duel_id, agreeVotes, disagreeVotes, totalVotes, createdAt).catch(() => {});

      if (justConcluded) {
        newlyConcluded.push(row.cloak_address);
      }

      results.push({ cloakAddress: row.cloak_address, action: 'vote_sync', status: 'success' });
    } catch (err: any) {
      results.push({ cloakAddress: row.cloak_address, action: 'vote_sync', status: 'error', reason: err?.message });
    }
  }

  return newlyConcluded;
}

/** Resolve expired council removal proposals. */
async function resolveExpiredRemovals(results: CloakResult[]): Promise<void> {
  const { rows: expired } = await pool.query(
    `SELECT id, cloak_address, target_address, target_username
     FROM council_removals
     WHERE resolved = FALSE AND ends_at <= NOW()`,
  );
  if (expired.length === 0) return;

  for (const removal of expired) {
    try {
      // Count votes
      const { rows: voteCounts } = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN vote = TRUE THEN 1 ELSE 0 END), 0)::int AS votes_for,
           COALESCE(SUM(CASE WHEN vote = FALSE THEN 1 ELSE 0 END), 0)::int AS votes_against
         FROM council_removal_votes WHERE removal_id = $1`,
        [removal.id],
      );

      // Get total council member count
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM council_members WHERE cloak_address = $1`,
        [removal.cloak_address],
      );
      const totalMembers = countRows[0]?.cnt ?? 0;

      const votesFor = voteCounts[0]?.votes_for ?? 0;
      const majority = Math.floor(totalMembers / 2) + 1;
      const shouldRemove = votesFor >= majority;

      if (shouldRemove) {
        // Delete by username (more reliable) or by address as fallback
        if (removal.target_username) {
          await pool.query(
            `DELETE FROM council_members WHERE cloak_address = $1 AND LOWER(username) = LOWER($2)`,
            [removal.cloak_address, removal.target_username],
          );
        } else {
          await pool.query(
            `DELETE FROM council_members WHERE cloak_address = $1 AND user_address = $2`,
            [removal.cloak_address, removal.target_address],
          );
        }
      }

      await pool.query(
        `UPDATE council_removals SET resolved = TRUE, outcome = $1 WHERE id = $2`,
        [shouldRemove ? 'removed' : 'kept', removal.id],
      );

      console.log(`[Keeper Cron] Removal #${removal.id} resolved: ${shouldRemove ? 'removed' : 'kept'} ${removal.target_username || removal.target_address.slice(0, 14)}`);
      results.push({ cloakAddress: removal.cloak_address, action: `resolve_removal_${removal.id}`, status: 'success' });
    } catch (err: any) {
      console.warn(`[Keeper Cron] Resolve removal #${removal.id} failed: ${err?.message}`);
      results.push({ cloakAddress: removal.cloak_address, action: `resolve_removal_${removal.id}`, status: 'error', reason: err?.message });
    }
  }
}

router.get('/', async (req: Request, res: Response) => {
  const apiSecret = process.env.KEEPER_API_SECRET;
  if (!apiSecret) return res.status(500).json({ error: 'Keeper not configured' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${apiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results: CloakResult[] = [];
    const port = process.env.PORT || 3001;

    // 1. Auto-advance duels from schedule
    const dueCloaks = await getDueCloaks();
    for (const schedule of dueCloaks) {
      try {
        const stmtCount = await getAvailableStatementCount(schedule.cloak_address);
        if (stmtCount === 0) {
          results.push({ cloakAddress: schedule.cloak_address, action: 'auto_advance', status: 'skipped', reason: 'No statements' });
          continue;
        }

        // Call advance-duel internally
        const resp = await fetch(`http://localhost:${port}/api/advance-duel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cloakAddress: schedule.cloak_address }),
        });
        const data = await resp.json();

        if (data.status === 'success') {
          results.push({ cloakAddress: schedule.cloak_address, action: 'auto_advance', status: 'success' });
        } else {
          results.push({ cloakAddress: schedule.cloak_address, action: 'auto_advance', status: 'skipped', reason: data.reason || data.error });
        }
      } catch (err: any) {
        results.push({ cloakAddress: schedule.cloak_address, action: 'auto_advance', status: 'error', reason: err?.message });
      }
    }

    // 2. Backfill missing duel_snapshots from on-chain
    try {
      await backfillMissingDuels(results);
    } catch (err: any) {
      console.warn('[Keeper Cron] Backfill error (non-fatal):', err?.message);
    }

    // 3. Sync vote counts from on-chain
    let newlyConcluded: string[] = [];
    try {
      newlyConcluded = await syncVoteCounts(results);
    } catch (err: any) {
      console.warn('[Keeper Cron] Vote sync error (non-fatal):', err?.message);
    }

    // 4. Immediately advance duels for cloaks that just concluded (if statements queued)
    const alreadyAdvanced = new Set(dueCloaks.filter((s) => results.some((r) => r.cloakAddress === s.cloak_address && r.action === 'auto_advance' && r.status === 'success')).map((s) => s.cloak_address));
    for (const cloakAddress of [...new Set(newlyConcluded)]) {
      if (alreadyAdvanced.has(cloakAddress)) continue; // Already advanced this cycle
      try {
        const stmtCount = await getAvailableStatementCount(cloakAddress);
        if (stmtCount === 0) {
          results.push({ cloakAddress, action: 'immediate_advance', status: 'skipped', reason: 'No statements' });
          continue;
        }
        console.log(`[Keeper Cron] Duel just concluded for ${cloakAddress.slice(0, 14)}... — advancing immediately`);
        const resp = await fetch(`http://localhost:${port}/api/advance-duel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cloakAddress }),
        });
        const data = await resp.json();
        if (data.status === 'success') {
          results.push({ cloakAddress, action: 'immediate_advance', status: 'success' });
        } else {
          results.push({ cloakAddress, action: 'immediate_advance', status: 'skipped', reason: data.reason || data.error });
        }
      } catch (err: any) {
        results.push({ cloakAddress, action: 'immediate_advance', status: 'error', reason: err?.message });
      }
    }

    // 5. Resolve expired council removal proposals
    try {
      await resolveExpiredRemovals(results);
    } catch (err: any) {
      console.warn('[Keeper Cron] Removal resolution error (non-fatal):', err?.message);
    }

    return res.json({
      status: 'completed',
      dueCount: dueCloaks.length,
      results,
    });
  } catch (err: any) {
    console.error('[Keeper Cron] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Cron failed' });
  }
});

export default router;
