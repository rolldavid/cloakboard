/**
 * Join/leave cloaks (community-level, replaces duel-level stars).
 *
 * POST   /api/cloaks/join  — Join a cloak
 * DELETE /api/cloaks/join  — Leave a cloak
 * GET    /api/cloaks/join  — List user's joined cloaks
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

// POST /api/cloaks/join
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { cloakAddress } = req.body;
  if (!cloakAddress) {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }

  try {
    await pool.query(
      `INSERT INTO cloak_joins (cloak_address, user_address)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cloakAddress, user.address],
    );
    return res.json({ joined: true });
  } catch (err: any) {
    console.error('[joins:post] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// DELETE /api/cloaks/join
router.delete('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { cloakAddress } = req.body;
  if (!cloakAddress) {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }

  try {
    await pool.query(
      `DELETE FROM cloak_joins WHERE cloak_address = $1 AND user_address = $2`,
      [cloakAddress, user.address],
    );
    return res.json({ joined: false });
  } catch (err: any) {
    console.error('[joins:delete] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /api/cloaks/join?user=ADDRESS
router.get('/', async (req: Request, res: Response) => {
  const userAddress = req.query.user as string;
  if (!userAddress) {
    return res.status(400).json({ error: 'Missing user query param' });
  }

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (cj.cloak_address)
         cj.cloak_address AS address,
         ds.cloak_name AS name,
         ds.cloak_slug AS slug
       FROM cloak_joins cj
       LEFT JOIN duel_snapshots ds ON ds.cloak_address = cj.cloak_address
       WHERE cj.user_address = $1
       ORDER BY cj.cloak_address, ds.created_at DESC`,
      [userAddress],
    );

    return res.json({ cloaks: result.rows });
  } catch (err: any) {
    console.error('[joins:get] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
