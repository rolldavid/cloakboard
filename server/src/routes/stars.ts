/**
 * Star/unstar duels.
 *
 * POST   /api/duels/star  — Star a duel
 * DELETE /api/duels/star  — Unstar a duel
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

// POST /api/duels/star
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { cloakAddress, duelId } = req.body;
  if (!cloakAddress || duelId === undefined) {
    return res.status(400).json({ error: 'Missing cloakAddress or duelId' });
  }

  try {
    await pool.query(
      `INSERT INTO duel_stars (cloak_address, duel_id, user_address)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [cloakAddress, duelId, user.address],
    );

    return res.json({ starred: true });
  } catch (err: any) {
    console.error('[stars:post] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// DELETE /api/duels/star
router.delete('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { cloakAddress, duelId } = req.body;
  if (!cloakAddress || duelId === undefined) {
    return res.status(400).json({ error: 'Missing cloakAddress or duelId' });
  }

  try {
    await pool.query(
      `DELETE FROM duel_stars WHERE cloak_address = $1 AND duel_id = $2 AND user_address = $3`,
      [cloakAddress, duelId, user.address],
    );

    return res.json({ starred: false });
  } catch (err: any) {
    console.error('[stars:delete] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
