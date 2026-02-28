/**
 * Cloak metadata routes.
 *
 * GET /api/cloaks/recent          — Recent cloaks
 * GET /api/cloaks/explore         — All cloaks with stats
 * GET /api/cloaks/:address/info   — Cloak metadata + council
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import { getDuelSchedule } from '../lib/db/duelSchedule.js';

const router = Router();

// GET /api/cloaks/check-name?name=X
router.get('/check-name', async (req: Request, res: Response) => {
  const name = req.query.name as string;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing name parameter' });
  }

  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    return res.json({ available: false, reason: 'Invalid name' });
  }

  try {
    const result = await pool.query(
      `SELECT 1 FROM duel_snapshots WHERE cloak_slug = $1 LIMIT 1`,
      [slug],
    );

    if (result.rows.length > 0) {
      return res.json({ available: false, reason: 'This name is already taken' });
    }

    return res.json({ available: true });
  } catch (err: any) {
    console.error('[cloaks:check-name] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/cloaks/recent
router.get('/recent', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) || '10', 10), 50);

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (cloak_address)
         cloak_address AS address, cloak_name AS name, cloak_slug AS slug
       FROM duel_snapshots
       ORDER BY cloak_address, created_at DESC
       LIMIT $1`,
      [limit],
    );

    return res.json({ cloaks: result.rows });
  } catch (err: any) {
    console.error('[cloaks:recent] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/cloaks/explore
router.get('/explore', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        cloak_address AS address,
        cloak_name AS name,
        cloak_slug AS slug,
        COUNT(DISTINCT duel_id)::int AS duel_count,
        COALESCE(SUM(total_votes), 0)::int AS vote_count,
        MAX(created_at) AS last_activity
      FROM duel_snapshots
      GROUP BY cloak_address, cloak_name, cloak_slug
      ORDER BY last_activity DESC
    `);

    return res.json({ cloaks: result.rows });
  } catch (err: any) {
    console.error('[cloaks:explore] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/cloaks/:address/info
router.get('/:address/info', async (req: Request, res: Response) => {
  const address = req.params.address;
  const viewer = req.query.viewer as string | undefined;

  try {
    // Try matching by address or slug
    const snapshotResult = await pool.query(
      `SELECT cloak_address, cloak_name, cloak_slug
       FROM duel_snapshots
       WHERE cloak_address = $1 OR cloak_slug = $1
       LIMIT 1`,
      [address],
    );

    const cloakAddress = snapshotResult.rows[0]?.cloak_address || address;

    // Get council
    const councilResult = await pool.query(
      `SELECT user_address, username, role FROM council_members
       WHERE cloak_address = $1 ORDER BY role DESC, added_at ASC`,
      [cloakAddress],
    );

    const council = councilResult.rows.map((row) => ({
      userAddress: row.user_address,
      username: row.username,
      role: row.role,
    }));

    // Get schedule info
    let nextDuelAt: string | null = null;
    let duelIntervalSeconds: number | null = null;
    try {
      const schedule = await getDuelSchedule(cloakAddress);
      if (schedule) {
        nextDuelAt = schedule.next_duel_at;
        duelIntervalSeconds = schedule.duel_interval_seconds;
      }
    } catch { /* schedule table may not exist */ }

    // Check for pending invite for viewer
    let pendingInvite = false;
    if (viewer) {
      try {
        const inviteResult = await pool.query(
          `SELECT 1 FROM council_invites
           WHERE cloak_address = $1 AND LOWER(username) = LOWER($2) AND claimed_by IS NULL`,
          [cloakAddress, viewer],
        );
        pendingInvite = (inviteResult.rowCount ?? 0) > 0;
      } catch { /* table may not exist yet */ }
    }

    return res.json({ description: null, council, nextDuelAt, duelIntervalSeconds, pendingInvite });
  } catch (err: any) {
    console.error('[cloaks:info] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
