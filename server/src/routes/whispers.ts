/**
 * GET /api/whispers/:address — Get whisper stats for a user
 */

import { Router, type Request, type Response } from 'express';
import { getWhisperStats, getWhisperLevel, getNextLevel } from '../lib/db/whisperService.js';

const router = Router();

router.get('/:address', async (req: Request, res: Response) => {
  const address = req.params.address;

  try {
    const stats = await getWhisperStats(address);
    const level = getWhisperLevel(stats.totalPoints);
    const next = getNextLevel(stats.totalPoints);

    return res.json({
      ...stats,
      level: level.level,
      levelName: level.name,
      nextLevel: next ? { level: next.level, name: next.name, minPoints: next.minPoints } : null,
    });
  } catch (err: any) {
    console.error('[whispers] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
