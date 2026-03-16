/**
 * Comments API V2 — adapted for new duel-centric schema (no cloak references).
 *
 * GET  /api/comments           — Fetch comments for a duel
 * POST /api/comments           — Create comment
 * DELETE /api/comments/:id     — Soft-delete comment
 * PUT  /api/comments/:id/vote  — Vote on comment
 */

import { Router, type Request, type Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { pool } from '../lib/db/pool.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

function getUser(req: AuthenticatedRequest) {
  return req.user;
}

// GET /api/comments?duelId=...&periodId=...
router.get('/', async (req: Request, res: Response) => {
  const duelId = parseInt(req.query.duelId as string, 10);
  const periodId = req.query.periodId ? parseInt(req.query.periodId as string, 10) : undefined;
  const sort = (req.query.sort as string) || 'best';
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  // Prefer authenticated user's address over query param (avoids leaking address in URLs/logs)
  const viewer = (req as AuthenticatedRequest).user?.address || (req.query.viewer as string | undefined);

  if (isNaN(duelId)) {
    return res.status(400).json({ error: 'Missing duelId' });
  }

  try {
    const params: any[] = [duelId];
    let paramIdx = 2;

    let periodFilter = '';
    if (periodId !== undefined) {
      params.push(periodId);
      periodFilter = ` AND c.period_id = $${paramIdx}`;
      paramIdx++;
    }

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
      case 'top':
        orderClause = '(c.upvotes - c.downvotes) DESC, c.created_at ASC';
        break;
      case 'best':
      default:
        orderClause = `(
          (c.upvotes - c.downvotes)
          + 2.0 / (1 + EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600)
          + 0.5 * LN(GREATEST(c.upvotes + c.downvotes, 1))
        ) DESC`;
        break;
    }

    params.push(limit);

    const query = `
      SELECT
        c.id, c.duel_id, c.parent_id,
        c.author_address, c.author_name, c.body,
        c.upvotes, c.downvotes, (c.upvotes - c.downvotes) AS score,
        c.is_deleted, c.created_at,
        COUNT(*) OVER ()::int AS total_count
        ${viewerSelect}
      FROM comments c
      ${viewerJoin}
      WHERE c.duel_id = $1${periodFilter}
      ORDER BY ${orderClause}
      LIMIT $${paramIdx}
    `;

    const result = await pool.query(query, params);

    const totalCount = result.rows.length > 0 ? result.rows[0].total_count : 0;
    const comments = result.rows.map((row) => ({
      id: row.id,
      duelId: row.duel_id,
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

    return res.json({ comments, totalCount });
  } catch (err: any) {
    console.error('[comments:get] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/comments
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address || !user?.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { duelId, parentId, body, periodId } = req.body;

  if (duelId === undefined) {
    return res.status(400).json({ error: 'Missing duelId' });
  }
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'Comment body required' });
  }
  if (body.length > 2000) {
    return res.status(400).json({ error: 'Comment body exceeds 2000 characters' });
  }

  try {
    // Rate limit: 15 seconds
    const rateCheck = await pool.query(
      `SELECT 1 FROM comments
       WHERE author_address = $1 AND created_at > NOW() - INTERVAL '15 seconds'
       LIMIT 1`,
      [user.address],
    );
    if (rateCheck.rowCount && rateCheck.rowCount > 0) {
      return res.status(429).json({ error: 'Please wait 15 seconds between comments' });
    }

    // Validate parent
    if (parentId) {
      const parentCheck = await pool.query(
        `SELECT 1 FROM comments WHERE id = $1 AND duel_id = $2`,
        [parentId, duelId],
      );
      if (parentCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Parent comment not found' });
      }
    }

    const result = await pool.query(
      `INSERT INTO comments (duel_id, parent_id, author_address, author_name, body, period_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, duel_id, parent_id, author_address, author_name, body,
                 upvotes, downvotes, (upvotes - downvotes) AS score, is_deleted, created_at`,
      [duelId, parentId || null, user.address, user.name, sanitizeHtml(body.trim(), { allowedTags: [], allowedAttributes: {} }), periodId || null],
    );

    const row = result.rows[0];

    // Fire-and-forget: notify parent comment author of reply
    if (parentId) {
      (async () => {
        try {
          const parent = await pool.query(
            `SELECT author_address FROM comments WHERE id = $1`,
            [parentId],
          );
          const parentAuthor = parent.rows[0]?.author_address;
          if (parentAuthor && parentAuthor !== user.address) {
            const { createNotification } = await import('../lib/notifications/notificationService.js');
            // Look up duel slug for deep-link
            const duelRow = await pool.query(`SELECT slug, title FROM duels WHERE id = $1`, [duelId]);
            await createNotification({
              recipientAddress: parentAuthor,
              type: 'comment_reply',
              duelId,
              duelSlug: duelRow.rows[0]?.slug,
              duelTitle: duelRow.rows[0]?.title,
              message: `${user.name} replied to your comment`,
            });
          }
        } catch (err: any) {
          console.warn('[comments:notify] Failed:', err?.message);
        }
      })();
    }

    return res.status(201).json({
      id: row.id,
      duelId: row.duel_id,
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
    return res.status(500).json({ error: 'Failed to create comment' });
  }
});

// DELETE /api/comments/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
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
    return res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// PUT /api/comments/:id/vote
router.put('/:id/vote', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
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
    // Use a transaction to prevent race conditions with concurrent votes
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT direction FROM comment_votes WHERE comment_id = $1 AND voter_address = $2 FOR UPDATE`,
        [commentId, user.address],
      );

      const hasExisting = existing.rowCount !== null && existing.rowCount > 0;
      const existingDir = hasExisting ? existing.rows[0].direction : null;

      if (!hasExisting) {
        if (direction !== 0) {
          await client.query(
            `INSERT INTO comment_votes (comment_id, voter_address, direction) VALUES ($1, $2, $3)`,
            [commentId, user.address, direction],
          );
        }
      } else {
        if (existingDir === direction || direction === 0) {
          await client.query(
            `DELETE FROM comment_votes WHERE comment_id = $1 AND voter_address = $2`,
            [commentId, user.address],
          );
        } else {
          await client.query(
            `UPDATE comment_votes SET direction = $3 WHERE comment_id = $1 AND voter_address = $2`,
            [commentId, user.address, direction],
          );
        }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const comment = await pool.query(
      `SELECT upvotes, downvotes FROM comments WHERE id = $1`,
      [commentId],
    );
    if (comment.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

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
    return res.status(500).json({ error: 'Failed to vote on comment' });
  }
});

export default router;
