/**
 * Notifications API — inbox + preferences.
 *
 * GET  /api/notifications              — fetch notifications
 * PUT  /api/notifications/:id/read     — mark one as read
 * PUT  /api/notifications/read-all     — mark all as read
 * GET  /api/notifications/preferences  — get preferences
 * PUT  /api/notifications/preferences  — upsert preferences
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

function getUser(req: AuthenticatedRequest) {
  return req.user;
}

// GET /api/notifications?limit=20&unreadOnly=false
router.get('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
  const unreadOnly = req.query.unreadOnly === 'true';

  try {
    const filter = unreadOnly ? ' AND is_read = FALSE' : '';
    const result = await pool.query(
      `SELECT id, type, duel_id, duel_slug, duel_title, message, metadata, is_read, created_at
       FROM notifications
       WHERE recipient_address = $1${filter}
       ORDER BY created_at DESC
       LIMIT $2`,
      [user.address, limit],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
       WHERE recipient_address = $1 AND is_read = FALSE`,
      [user.address],
    );

    return res.json({
      notifications: result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        duelId: row.duel_id,
        duelSlug: row.duel_slug,
        duelTitle: row.duel_title,
        message: row.message,
        metadata: row.metadata,
        isRead: row.is_read,
        createdAt: row.created_at,
      })),
      unreadCount: countResult.rows[0].count,
    });
  } catch (err: any) {
    console.error('[notifications:get] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/read-all (must be before /:id/read to avoid route collision)
router.put('/read-all', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE recipient_address = $1 AND is_read = FALSE`,
      [user.address],
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[notifications:readAll] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid notification id' });
  }

  try {
    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_address = $2 RETURNING id`,
      [id, user.address],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[notifications:read] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// GET /api/notifications/preferences
router.get('/preferences', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const result = await pool.query(
      `SELECT comment_replies, created_duel_ended FROM notification_preferences WHERE address = $1`,
      [user.address],
    );

    if (result.rowCount === 0) {
      return res.json({ commentReplies: true, createdDuelEnded: true });
    }

    const row = result.rows[0];
    return res.json({
      commentReplies: row.comment_replies,
      createdDuelEnded: row.created_duel_ended,
    });
  } catch (err: any) {
    console.error('[notifications:prefs:get] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// PUT /api/notifications/preferences
router.put('/preferences', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { commentReplies, createdDuelEnded } = req.body;

  try {
    await pool.query(
      `INSERT INTO notification_preferences (address, comment_replies, created_duel_ended, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (address) DO UPDATE SET
         comment_replies = EXCLUDED.comment_replies,
         created_duel_ended = EXCLUDED.created_duel_ended,
         updated_at = NOW()`,
      [user.address, commentReplies ?? true, createdDuelEnded ?? true],
    );
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[notifications:prefs:put] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

export default router;
