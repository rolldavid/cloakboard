/**
 * GET  /api/duels/sync — Returns duel data from Postgres snapshots.
 * POST /api/duels/sync — Syncs a specific duel's vote counts from on-chain into Postgres.
 *
 * V4: Uses direct public storage reads (no PXE simulation, no artifact loading).
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import { upsertDuelSnapshot } from '../lib/db/duelSnapshotSync.js';
import { insertTimelineSnapshot, maybeInsertSnapshot } from '../lib/db/voteTimeline.js';
import { readDuelDirect } from '../lib/aztec/publicStorageReader.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const cloakAddress = req.query.cloakAddress as string;

  if (!cloakAddress) {
    return res.status(400).json({ error: 'Missing cloakAddress query param' });
  }

  try {
    const result = await pool.query(
      `SELECT duel_id, statement_text, start_block, end_block,
              total_votes, agree_votes, disagree_votes, is_tallied,
              cloak_name, cloak_slug
       FROM duel_snapshots
       WHERE cloak_address = $1
       ORDER BY duel_id ASC`,
      [cloakAddress],
    );

    const duels = result.rows.map((row: any) => ({
      id: row.duel_id,
      statementText: row.statement_text,
      startBlock: row.start_block,
      endBlock: row.end_block,
      totalVotes: row.total_votes ?? 0,
      agreeVotes: row.agree_votes ?? 0,
      disagreeVotes: row.disagree_votes ?? 0,
      isTallied: row.is_tallied ?? false,
    }));

    return res.json({
      status: 'success',
      cloakAddress,
      duels,
    });
  } catch (err: any) {
    console.error('[duel-sync] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch duel data' });
  }
});

/**
 * POST /api/duels/sync — Sync a specific duel from on-chain state into Postgres.
 * Called by the client after casting a vote to update tallies without waiting for cron.
 *
 * Uses direct public storage reads — no PXE, no simulation, no artifact needed.
 * Accepts optional `expectedMinVotes` — retries up to 3 times with 3s delay
 * when the on-chain total is less than expected (block propagation lag).
 */
router.post('/', async (req: Request, res: Response) => {
  const { cloakAddress, duelId, expectedMinVotes } = req.body;

  if (!cloakAddress || duelId == null) {
    return res.status(400).json({ error: 'Missing cloakAddress or duelId' });
  }

  try {
    const { getNode } = await import('../lib/keeper/wallet.js');
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');

    const node = await getNode();
    const cloakAddr = AztecAddress.fromString(cloakAddress);

    let totalVotes = 0;
    let agreeVotes = 0;
    let disagreeVotes = 0;
    let isTallied = false;

    // Retry loop for block propagation lag.
    // NO_WAIT votes resolve after proof+send (~10-15s) but mining takes ~30-60s.
    // Use aggressive retries to catch up: 12 attempts x 5s = 60s max wait.
    const maxAttempts = expectedMinVotes ? 12 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const duelData = await readDuelDirect(node, cloakAddr, duelId);

      totalVotes = duelData.totalVotes;
      agreeVotes = duelData.agreeVotes;
      disagreeVotes = duelData.disagreeVotes;
      isTallied = duelData.isTallied;

      if (!expectedMinVotes || totalVotes >= expectedMinVotes || attempt >= maxAttempts - 1) {
        break;
      }
      console.log(`[duel-sync] Retry ${attempt + 1}/${maxAttempts}: on-chain total=${totalVotes}, expected>=${expectedMinVotes}`);
      await new Promise(r => setTimeout(r, 5000));
    }

    // Upsert into Postgres (creates row if missing, updates if exists).
    // Never downgrade vote counts — on-chain reads may be stale if the
    // vote tx hasn't been mined yet (NO_WAIT resolves before mining).
    const existingRow = await pool.query(
      `SELECT cloak_name, cloak_slug, statement_text, start_block, end_block, total_votes FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );
    const row = existingRow.rows[0];
    const existingTotal = row?.total_votes ?? 0;

    // Read blocks from on-chain if DB has zeros
    let startBlock = row?.start_block || 0;
    let endBlock = row?.end_block || 0;
    if (startBlock === 0 || endBlock === 0) {
      try {
        const onChainDuel = await readDuelDirect(node, cloakAddr, duelId);
        startBlock = onChainDuel.startBlock || startBlock;
        endBlock = onChainDuel.endBlock || endBlock;
      } catch { /* already read vote data above, blocks are bonus */ }
    }

    // Only write to DB if on-chain total is >= what's already stored
    if (totalVotes >= existingTotal) {
      await upsertDuelSnapshot({
        cloakAddress,
        cloakName: row?.cloak_name || '',
        cloakSlug: row?.cloak_slug || '',
        duelId,
        statementText: row?.statement_text || '',
        startBlock,
        endBlock,
        totalVotes,
        agreeVotes,
        disagreeVotes,
        isTallied,
      });
    } else {
      console.log(`[duel-sync] Skipping DB write: on-chain total=${totalVotes} < existing=${existingTotal} (tx not mined yet)`);
    }

    // Insert timeline snapshot for chart.
    // Vote-triggered syncs (expectedMinVotes present) always write directly — the user
    // just voted and needs to see the chart update immediately. Cron-triggered syncs
    // (no expectedMinVotes) use the throttled version to avoid spamming timeline data.
    if (expectedMinVotes) {
      await insertTimelineSnapshot(cloakAddress, duelId, agreeVotes, disagreeVotes, totalVotes);
    } else {
      const snapRow = await pool.query(
        `SELECT created_at FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
        [cloakAddress, duelId],
      );
      const duelCreatedAt = snapRow.rows[0]?.created_at ? new Date(snapRow.rows[0].created_at) : new Date();
      await maybeInsertSnapshot(cloakAddress, duelId, agreeVotes, disagreeVotes, totalVotes, duelCreatedAt);
    }

    return res.json({ totalVotes, agreeVotes, disagreeVotes, isTallied });
  } catch (err: any) {
    console.error('[duel-sync] POST error:', err?.message);
    return res.status(500).json({ error: 'Sync failed' });
  }
});

export default router;
