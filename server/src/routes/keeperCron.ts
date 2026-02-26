/**
 * GET /api/keeper/cron
 *
 * Keeper Cron:
 * 1. Check duel_schedule for auto-advance — calls advance-duel for due cloaks
 * 2. Sync vote counts from on-chain state into duel_snapshots
 *
 * V4: Uses direct public storage reads (no PXE simulation, no artifact loading).
 */

import { Router, type Request, type Response } from 'express';
import { getDueCloaks } from '../lib/db/duelSchedule';
import { getAvailableStatementCount } from '../lib/db/statements';
import { pool } from '../lib/db/pool.js';
import { getNode } from '../lib/keeper/wallet';
import { maybeInsertSnapshot } from '../lib/db/voteTimeline';
import { readDuelDirect } from '../lib/aztec/publicStorageReader.js';

const router = Router();

interface CloakResult {
  cloakAddress: string;
  action: string;
  status: 'success' | 'skipped' | 'error';
  reason?: string;
}

/** Sync on-chain vote counts into duel_snapshots for active duels. */
async function syncVoteCounts(results: CloakResult[]): Promise<void> {
  const { rows: activeDuels } = await pool.query(
    `SELECT cloak_address, duel_id FROM duel_snapshots WHERE is_tallied = false`,
  );
  if (activeDuels.length === 0) return;

  let node: any;
  try {
    node = await getNode();
  } catch {
    // Node not available — skip sync silently
    return;
  }

  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  for (const row of activeDuels) {
    try {
      const cloakAddr = AztecAddress.fromString(row.cloak_address);
      const duelData = await readDuelDirect(node, cloakAddr, row.duel_id);

      const totalVotes = duelData.totalVotes;
      const agreeVotes = duelData.agreeVotes;
      const disagreeVotes = duelData.disagreeVotes;
      const isTallied = duelData.isTallied;

      await pool.query(
        `UPDATE duel_snapshots
         SET total_votes = $1, agree_votes = $2, disagree_votes = $3, is_tallied = $4, updated_at = NOW()
         WHERE cloak_address = $5 AND duel_id = $6`,
        [totalVotes, agreeVotes, disagreeVotes, isTallied, row.cloak_address, row.duel_id],
      );

      // Insert timeline snapshot for chart
      const snapRow = await pool.query(
        `SELECT created_at FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
        [row.cloak_address, row.duel_id],
      );
      const createdAt = snapRow.rows[0]?.created_at ? new Date(snapRow.rows[0].created_at) : new Date();
      await maybeInsertSnapshot(row.cloak_address, row.duel_id, agreeVotes, disagreeVotes, totalVotes, createdAt).catch(() => {});

      results.push({ cloakAddress: row.cloak_address, action: 'vote_sync', status: 'success' });
    } catch (err: any) {
      results.push({ cloakAddress: row.cloak_address, action: 'vote_sync', status: 'error', reason: err?.message });
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

    // 2. Sync vote counts from on-chain
    try {
      await syncVoteCounts(results);
    } catch (err: any) {
      console.warn('[Keeper Cron] Vote sync error (non-fatal):', err?.message);
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
