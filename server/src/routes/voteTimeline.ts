/**
 * GET /api/duels/timeline?cloakAddress=X&duelId=Y
 *
 * Returns vote timeline snapshots for rendering the line chart.
 */

import { Router, type Request, type Response } from 'express';
import { getTimelineSnapshots } from '../lib/db/voteTimeline.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const cloakAddress = req.query.cloakAddress as string;
  const duelId = parseInt(req.query.duelId as string, 10);

  if (!cloakAddress || isNaN(duelId)) {
    return res.status(400).json({ error: 'Missing cloakAddress or duelId' });
  }

  try {
    const snapshots = await getTimelineSnapshots(cloakAddress, duelId);
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
    return res.json({ snapshots });
  } catch (err: any) {
    console.error('[vote-timeline] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
