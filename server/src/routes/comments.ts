/**
 * Comments API — CRUD + voting for duel comments.
 *
 * GET  /api/comments           — Fetch comments for a duel
 * POST /api/comments           — Create comment
 * DELETE /api/comments/:id     — Soft-delete comment
 * PUT  /api/comments/:id/vote  — Vote on comment
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

// GET /api/comments
router.get('/', async (req: Request, res: Response) => {
  const duelId = parseInt(req.query.duelId as string, 10);
  const cloakAddress = req.query.cloakAddress as string;
  const sort = (req.query.sort as string) || 'top';
  const limit = Math.min(parseInt((req.query.limit as string) || '25', 10), 200);
  const viewer = req.query.viewer as string | undefined;

  if (!cloakAddress || isNaN(duelId)) {
    return res.status(400).json({ error: 'Missing duelId or cloakAddress' });
  }

  try {
    const params: any[] = [cloakAddress, duelId];
    let paramIdx = 3;

    let viewerSelect = ', NULL::smallint AS my_vote';
    let viewerJoin = '';
    if (viewer) {
      params.push(viewer);
      viewerSelect = `, cv.direction AS my_vote`;
      viewerJoin = ` LEFT JOIN comment_votes cv ON cv.comment_id = c.id AND cv.voter_address = $${paramIdx}`;
      paramIdx++;
    }

    let orderClause: string;
    switch (sort) {
      case 'new':
        orderClause = 'c.created_at DESC';
        break;
      case 'old':
        orderClause = 'c.created_at ASC';
        break;
      case 'controversial':
        orderClause = `(c.upvotes + c.downvotes) * (1 - ABS((c.upvotes::float / NULLIF(c.upvotes + c.downvotes, 0) - 0.5) * 2)) DESC`;
        break;
      case 'top':
      default:
        orderClause = '(c.upvotes - c.downvotes) DESC, c.created_at ASC';
        break;
    }

    params.push(limit);

    const query = `
      SELECT
        c.id, c.duel_id, c.cloak_address, c.parent_id,
        c.author_address, c.author_name, c.body,
        c.upvotes, c.downvotes, (c.upvotes - c.downvotes) AS score,
        c.is_deleted, c.created_at
        ${viewerSelect}
      FROM comments c
      ${viewerJoin}
      WHERE c.cloak_address = $1 AND c.duel_id = $2
      ORDER BY ${orderClause}
      LIMIT $${paramIdx}
    `;

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM comments WHERE cloak_address = $1 AND duel_id = $2`,
      [cloakAddress, duelId],
    );

    const comments = result.rows.map((row) => ({
      id: row.id,
      duelId: row.duel_id,
      cloakAddress: row.cloak_address,
      parentId: row.parent_id,
      authorAddress: row.author_address,
      authorName: row.author_name,
      body: row.is_deleted ? '' : row.body,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      isDeleted: row.is_deleted,
      myVote: row.my_vote,
      createdAt: row.created_at,
    }));

    return res.json({ comments, totalCount: countResult.rows[0].count });
  } catch (err: any) {
    console.error('[comments:get] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /api/comments
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address || !user.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { duelId, cloakAddress, parentId, body } = req.body;

  if (!cloakAddress || duelId === undefined) {
    return res.status(400).json({ error: 'Missing duelId or cloakAddress' });
  }
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'Comment body required' });
  }
  if (body.length > 2000) {
    return res.status(400).json({ error: 'Comment body exceeds 2000 characters' });
  }

  try {
    // Check ban
    const banCheck = await pool.query(
      `SELECT 1 FROM banned_members WHERE cloak_address = $1 AND user_address = $2`,
      [cloakAddress, user.address],
    );
    if (banCheck.rowCount && banCheck.rowCount > 0) {
      return res.status(403).json({ error: 'You are banned from this community' });
    }

    // Rate limit: 30 seconds
    const rateCheck = await pool.query(
      `SELECT 1 FROM comments
       WHERE author_address = $1 AND created_at > NOW() - INTERVAL '30 seconds'
       LIMIT 1`,
      [user.address],
    );
    if (rateCheck.rowCount && rateCheck.rowCount > 0) {
      return res.status(429).json({ error: 'Please wait 30 seconds between comments' });
    }

    // Validate parent
    if (parentId) {
      const parentCheck = await pool.query(
        `SELECT 1 FROM comments WHERE id = $1 AND cloak_address = $2 AND duel_id = $3`,
        [parentId, cloakAddress, duelId],
      );
      if (parentCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Parent comment not found in this duel' });
      }
    }

    const result = await pool.query(
      `INSERT INTO comments (duel_id, cloak_address, parent_id, author_address, author_name, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, duel_id, cloak_address, parent_id, author_address, author_name, body,
                 upvotes, downvotes, (upvotes - downvotes) AS score, is_deleted, created_at`,
      [duelId, cloakAddress, parentId || null, user.address, user.name, body.trim()],
    );

    const row = result.rows[0];

    return res.status(201).json({
      id: row.id,
      duelId: row.duel_id,
      cloakAddress: row.cloak_address,
      parentId: row.parent_id,
      authorAddress: row.author_address,
      authorName: row.author_name,
      body: row.body,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      isDeleted: row.is_deleted,
      myVote: null,
      createdAt: row.created_at,
    });
  } catch (err: any) {
    console.error('[comments:post] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// DELETE /api/comments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const commentId = parseInt(req.params.id, 10);
  if (isNaN(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }

  try {
    const result = await pool.query(
      `UPDATE comments SET is_deleted = true, body = '', updated_at = NOW()
       WHERE id = $1 AND author_address = $2
       RETURNING id`,
      [commentId, user.address],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found or not your comment' });
    }

    return res.json({ deleted: true });
  } catch (err: any) {
    console.error('[comments:delete] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// PUT /api/comments/:id/vote
router.put('/:id/vote', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const commentId = parseInt(req.params.id, 10);
  if (isNaN(commentId)) {
    return res.status(400).json({ error: 'Invalid comment id' });
  }

  const { direction } = req.body;
  if (direction !== 1 && direction !== -1 && direction !== 0) {
    return res.status(400).json({ error: 'direction must be 1, -1, or 0' });
  }

  try {
    // Get existing vote
    const existing = await pool.query(
      `SELECT direction FROM comment_votes WHERE comment_id = $1 AND voter_address = $2`,
      [commentId, user.address],
    );

    const hasExisting = existing.rowCount !== null && existing.rowCount > 0;
    const existingDir = hasExisting ? existing.rows[0].direction : null;

    if (!hasExisting) {
      // No existing vote
      if (direction === 0) {
        // nothing to do
      } else {
        await pool.query(
          `INSERT INTO comment_votes (comment_id, voter_address, direction) VALUES ($1, $2, $3)`,
          [commentId, user.address, direction],
        );
      }
    } else {
      // Has existing vote
      if (existingDir === direction) {
        // Same direction → toggle off
        await pool.query(
          `DELETE FROM comment_votes WHERE comment_id = $1 AND voter_address = $2`,
          [commentId, user.address],
        );
      } else if (direction === 0) {
        // Remove vote
        await pool.query(
          `DELETE FROM comment_votes WHERE comment_id = $1 AND voter_address = $2`,
          [commentId, user.address],
        );
      } else {
        // Different direction → update
        await pool.query(
          `UPDATE comment_votes SET direction = $3 WHERE comment_id = $1 AND voter_address = $2`,
          [commentId, user.address, direction],
        );
      }
    }

    // Re-query the comment for updated counts
    const comment = await pool.query(
      `SELECT upvotes, downvotes FROM comments WHERE id = $1`,
      [commentId],
    );

    if (comment.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Get current vote state
    const currentVote = await pool.query(
      `SELECT direction FROM comment_votes WHERE comment_id = $1 AND voter_address = $2`,
      [commentId, user.address],
    );

    return res.json({
      upvotes: comment.rows[0].upvotes,
      downvotes: comment.rows[0].downvotes,
      myVote: currentVote.rowCount && currentVote.rowCount > 0 ? currentVote.rows[0].direction : null,
    });
  } catch (err: any) {
    console.error('[comments:vote] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
