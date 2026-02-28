/**
 * GET /api/keeper/warmup
 *
 * Eagerly initializes the keeper wallet so it's ready when deploy is called.
 * Protected with keeper auth to prevent external abuse.
 */

import { Router, type Request, type Response } from 'express';
import { requireKeeperAuth } from '../middleware/auth.js';
import { getKeeperWallet } from '../lib/keeper/wallet.js';

const router = Router();

router.get('/', requireKeeperAuth, async (_req: Request, res: Response) => {
  try {
    await getKeeperWallet();
    res.json({ status: 'warm' });
  } catch {
    res.status(500).json({ status: 'error', error: 'Warmup failed' });
  }
});

export default router;
