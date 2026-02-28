/**
 * GET /api/keeper/warmup
 *
 * Eagerly initializes the keeper wallet so it's ready when deploy is called.
 */

import { Router, type Request, type Response } from 'express';
import { getKeeperWallet } from '../lib/keeper/wallet.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    await getKeeperWallet();
    res.json({ status: 'warm' });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message });
  }
});

export default router;
