/**
 * GET  /api/duels/sync — Returns duel data from Postgres snapshots.
 * POST /api/duels/sync — Syncs a specific duel's vote counts from on-chain into Postgres.
 *
 * V4: Uses direct public storage reads (no PXE simulation, no artifact loading).
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import { upsertDuelSnapshot } from '../lib/db/duelSnapshotSync.js';
import { maybeInsertSnapshot } from '../lib/db/voteTimeline.js';
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
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
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

    // Retry loop for block propagation lag
    const maxAttempts = expectedMinVotes ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const duelData = await readDuelDirect(node, cloakAddr, duelId);

      totalVotes = duelData.totalVotes;
      agreeVotes = duelData.agreeVotes;
      disagreeVotes = duelData.disagreeVotes;
      isTallied = duelData.isTallied;

      if (!expectedMinVotes || totalVotes >= expectedMinVotes || attempt >= maxAttempts - 1) {
        break;
      }
      console.log(`[duel-sync] Retry ${attempt + 1}: on-chain total=${totalVotes}, expected>=${expectedMinVotes}`);
      await new Promise(r => setTimeout(r, 3000));
    }

    // Upsert into Postgres (creates row if missing, updates if exists)
    const existingRow = await pool.query(
      `SELECT cloak_name, cloak_slug, statement_text, start_block, end_block FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );
    const row = existingRow.rows[0];

    await upsertDuelSnapshot({
      cloakAddress,
      cloakName: row?.cloak_name || '',
      cloakSlug: row?.cloak_slug || '',
      duelId,
      statementText: row?.statement_text || '',
      startBlock: row?.start_block || 0,
      endBlock: row?.end_block || 0,
      totalVotes,
      agreeVotes,
      disagreeVotes,
      isTallied,
    });

    // Insert timeline snapshot for chart (respects interval throttling)
    const snapRow = await pool.query(
      `SELECT created_at FROM duel_snapshots WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );
    const duelCreatedAt = snapRow.rows[0]?.created_at ? new Date(snapRow.rows[0].created_at) : new Date();
    await maybeInsertSnapshot(cloakAddress, duelId, agreeVotes, disagreeVotes, totalVotes, duelCreatedAt);

    return res.json({ totalVotes, agreeVotes, disagreeVotes, isTallied });
  } catch (err: any) {
    console.error('[duel-sync] POST error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Sync failed' });
  }
});

export default router;
