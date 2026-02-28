/**
 * Ban management for cloaks.
 *
 * POST   /api/cloaks/:address/bans  — Ban a member
 * DELETE /api/cloaks/:address/bans  — Unban a member
 * GET    /api/cloaks/:address/bans  — List bans
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

function getUser(req: AuthenticatedRequest) {
  return req.user || {
    address: req.headers['x-user-address'] as string,
    name: req.headers['x-user-name'] as string,
  };
}

async function isCouncilMember(cloakAddress: string, username: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT role FROM council_members WHERE cloak_address = $1 AND LOWER(username) = LOWER($2) AND role >= 2`,
    [cloakAddress, username],
  );
  return (result.rowCount ?? 0) > 0;
}

// POST /api/cloaks/:address/bans
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const cloakAddress = req.params.address;
  const { username, reason } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }

  try {
    // Check caller is council (by username)
    if (!(await isCouncilMember(cloakAddress, user.name))) {
      return res.status(403).json({ error: 'Council role required' });
    }

    // Resolve username to address via comments table
    const userLookup = await pool.query(
      `SELECT DISTINCT author_address FROM comments
       WHERE author_name = $1 LIMIT 1`,
      [username],
    );

    if (userLookup.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetAddress = userLookup.rows[0].author_address;

    // Prevent banning council members (check by target username)
    if (await isCouncilMember(cloakAddress, username)) {
      return res.status(403).json({ error: 'Cannot ban a council member' });
    }

    await pool.query(
      `INSERT INTO banned_members (cloak_address, user_address, user_name, banned_by, banned_by_name, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cloak_address, user_address) DO UPDATE SET
         reason = $6, banned_by = $4, banned_by_name = $5, banned_at = NOW()`,
      [cloakAddress, targetAddress, username, user.address, user.name, reason || null],
    );

    return res.json({ banned: true });
  } catch (err: any) {
    console.error('[bans:post] Error:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/cloaks/:address/bans
router.delete('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const cloakAddress = req.params.address;
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Missing username' });
  }

  try {
    if (!(await isCouncilMember(cloakAddress, user.name))) {
      return res.status(403).json({ error: 'Council role required' });
    }

    // Resolve username to address
    const userLookup = await pool.query(
      `SELECT user_address FROM banned_members
       WHERE cloak_address = $1 AND user_name = $2`,
      [cloakAddress, username],
    );

    if (userLookup.rowCount === 0) {
      return res.status(404).json({ error: 'Ban not found' });
    }

    await pool.query(
      `DELETE FROM banned_members WHERE cloak_address = $1 AND user_address = $2`,
      [cloakAddress, userLookup.rows[0].user_address],
    );

    return res.json({ unbanned: true });
  } catch (err: any) {
    console.error('[bans:delete] Error:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cloaks/:address/bans
router.get('/', async (req: Request, res: Response) => {
  const cloakAddress = req.params.address;

  try {
    const result = await pool.query(
      `SELECT user_name AS username, user_address, reason, banned_at
       FROM banned_members WHERE cloak_address = $1
       ORDER BY banned_at DESC`,
      [cloakAddress],
    );

    return res.json({
      bans: result.rows.map((row) => ({
        username: row.username,
        userAddress: row.user_address,
        reason: row.reason,
        bannedAt: row.banned_at,
      })),
    });
  } catch (err: any) {
    console.error('[bans:get] Error:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
