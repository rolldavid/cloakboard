/**
 * GET /api/keeper/cron
 *
 * V6: Cron logic moved to internal setInterval in index.ts (snapshotCron.ts).
 * This endpoint is kept as a no-op for backward compatibility with external callers.
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Cron handled internally' });
});

export default router;
