/**
 * Duel quality votes — upvote/downvote on duel quality ("is this a good question?").
 *
 * PUT  /api/duels/vote/:cloakAddress/:duelId  — Vote on duel quality
 * GET  /api/duels/vote/:cloakAddress/:duelId  — Get quality vote counts
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';

const router = Router();

function getUser(req: Request) {
  return {
    address: req.headers['x-user-address'] as string,
    name: req.headers['x-user-name'] as string,
  };
}

// PUT /api/duels/vote/:cloakAddress/:duelId
router.put('/:cloakAddress/:duelId', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { cloakAddress, duelId: duelIdStr } = req.params;
  const duelId = parseInt(duelIdStr, 10);
  if (!cloakAddress || isNaN(duelId)) {
    return res.status(400).json({ error: 'Invalid cloakAddress or duelId' });
  }

  const { direction } = req.body;
  if (direction !== 1 && direction !== -1 && direction !== 0) {
    return res.status(400).json({ error: 'direction must be 1, -1, or 0' });
  }

  try {
    // Get existing vote
    const existing = await pool.query(
      `SELECT direction FROM duel_votes WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $3`,
      [cloakAddress, duelId, user.address],
    );

    const hasExisting = existing.rowCount !== null && existing.rowCount > 0;
    const existingDir = hasExisting ? existing.rows[0].direction : null;

    if (!hasExisting) {
      if (direction !== 0) {
        await pool.query(
          `INSERT INTO duel_votes (cloak_address, duel_id, voter_address, direction) VALUES ($1, $2, $3, $4)`,
          [cloakAddress, duelId, user.address, direction],
        );
      }
    } else {
      if (existingDir === direction) {
        // Same direction -> toggle off
        await pool.query(
          `DELETE FROM duel_votes WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $3`,
          [cloakAddress, duelId, user.address],
        );
      } else if (direction === 0) {
        // Remove vote
        await pool.query(
          `DELETE FROM duel_votes WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $3`,
          [cloakAddress, duelId, user.address],
        );
      } else {
        // Different direction -> update
        await pool.query(
          `UPDATE duel_votes SET direction = $3 WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $4`,
          [cloakAddress, duelId, direction, user.address],
        );
      }
    }

    // Re-query aggregate counts
    const counts = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 1 THEN 1 ELSE 0 END), 0)::int AS quality_upvotes,
        COALESCE(SUM(CASE WHEN direction = -1 THEN 1 ELSE 0 END), 0)::int AS quality_downvotes
      FROM duel_votes
      WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );

    // Get current vote state
    const currentVote = await pool.query(
      `SELECT direction FROM duel_votes WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $3`,
      [cloakAddress, duelId, user.address],
    );

    return res.json({
      qualityUpvotes: counts.rows[0].quality_upvotes,
      qualityDownvotes: counts.rows[0].quality_downvotes,
      myVote: currentVote.rowCount && currentVote.rowCount > 0 ? currentVote.rows[0].direction : null,
    });
  } catch (err: any) {
    console.error('[duelVotes:put] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/duels/vote/:cloakAddress/:duelId
router.get('/:cloakAddress/:duelId', async (req: Request, res: Response) => {
  const { cloakAddress, duelId: duelIdStr } = req.params;
  const duelId = parseInt(duelIdStr, 10);
  const viewer = req.query.viewer as string | undefined;

  if (!cloakAddress || isNaN(duelId)) {
    return res.status(400).json({ error: 'Invalid cloakAddress or duelId' });
  }

  try {
    const counts = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN direction = 1 THEN 1 ELSE 0 END), 0)::int AS quality_upvotes,
        COALESCE(SUM(CASE WHEN direction = -1 THEN 1 ELSE 0 END), 0)::int AS quality_downvotes
      FROM duel_votes
      WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );

    let myVote: number | null = null;
    if (viewer) {
      const viewerVote = await pool.query(
        `SELECT direction FROM duel_votes WHERE cloak_address = $1 AND duel_id = $2 AND voter_address = $3`,
        [cloakAddress, duelId, viewer],
      );
      if (viewerVote.rowCount && viewerVote.rowCount > 0) {
        myVote = viewerVote.rows[0].direction;
      }
    }

    return res.json({
      qualityUpvotes: counts.rows[0].quality_upvotes,
      qualityDownvotes: counts.rows[0].quality_downvotes,
      myVote,
    });
  } catch (err: any) {
    console.error('[duelVotes:get] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
