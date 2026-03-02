/**
 * GET /api/users/:username — User profile data (comments)
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';

const router = Router();

router.get('/:username', async (req: Request, res: Response) => {
  const username = req.params.username;

  try {
    // Get user address from comments (case-insensitive)
    const userLookup = await pool.query(
      `SELECT DISTINCT author_address, author_name FROM comments
       WHERE LOWER(author_name) = LOWER($1) LIMIT 1`,
      [username],
    );

    if (userLookup.rowCount === 0) {
      // User exists (has a username) but hasn't commented yet — return empty profile
      return res.json({
        username,
        address: null,
        comments: [],
      });
    }

    const { author_address: userAddress, author_name: authorName } = userLookup.rows[0];

    // Get recent comments with cloak info
    const commentsResult = await pool.query(
      `SELECT
         c.id, c.body, c.upvotes, c.downvotes, (c.upvotes - c.downvotes) AS score,
         c.is_deleted, c.created_at, c.duel_id, c.cloak_address,
         ds.cloak_name, ds.cloak_slug
       FROM comments c
       LEFT JOIN duel_snapshots ds ON ds.cloak_address = c.cloak_address AND ds.duel_id = c.duel_id
       WHERE c.author_address = $1 AND c.is_deleted = false
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [userAddress],
    );

    return res.json({
      username: authorName,
      address: userAddress,
      comments: commentsResult.rows.map((row) => ({
        id: row.id,
        body: row.body,
        score: row.score,
        duelId: row.duel_id,
        cloakAddress: row.cloak_address,
        cloakName: row.cloak_name,
        cloakSlug: row.cloak_slug,
        createdAt: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[users] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

export default router;
