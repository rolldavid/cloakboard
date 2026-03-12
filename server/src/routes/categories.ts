/**
 * Categories API
 * GET /api/categories — list all categories with their subcategories
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const catResult = await pool.query(
      `SELECT id, name, slug, sort_order FROM categories ORDER BY sort_order`,
    );
    const subResult = await pool.query(
      `SELECT s.id, s.category_id, s.name, s.slug, s.created_at,
              (COALESCE(rv.delta, 0) + COALESCE(rc.cnt, 0) * 2 + COALESCE(rcv.cnt, 0))::int AS activity,
              COALESCE(ad.cnt, 0)::int AS active_duel_count
       FROM subcategories s
       LEFT JOIN (
         SELECT subcategory_id, COUNT(*)::int AS cnt
         FROM duels WHERE status = 'active'
         GROUP BY subcategory_id
       ) ad ON ad.subcategory_id = s.id
       LEFT JOIN (
         SELECT d.subcategory_id,
                SUM(GREATEST(d.total_votes - COALESCE(snap24.total_votes, 0), 0))::int AS delta
         FROM duels d
         LEFT JOIN LATERAL (
           SELECT total_votes FROM vote_snapshots
           WHERE duel_id = d.id AND snapshot_at <= NOW() - INTERVAL '48 hours'
           ORDER BY snapshot_at DESC LIMIT 1
         ) snap24 ON true
         WHERE d.status = 'active'
         GROUP BY d.subcategory_id
       ) rv ON rv.subcategory_id = s.id
       LEFT JOIN (
         SELECT d.subcategory_id, COUNT(*)::int AS cnt
         FROM comments c
         JOIN duels d ON d.id = c.duel_id AND d.status = 'active'
         WHERE c.created_at >= NOW() - INTERVAL '48 hours'
         GROUP BY d.subcategory_id
       ) rc ON rc.subcategory_id = s.id
       LEFT JOIN (
         SELECT d.subcategory_id, COUNT(*)::int AS cnt
         FROM comment_votes cv
         JOIN comments c ON c.id = cv.comment_id
         JOIN duels d ON d.id = c.duel_id AND d.status = 'active'
         WHERE cv.created_at >= NOW() - INTERVAL '48 hours'
         GROUP BY d.subcategory_id
       ) rcv ON rcv.subcategory_id = s.id
       ORDER BY activity DESC, s.name`,
    );

    const subsByCategory = new Map<number, any[]>();
    for (const sub of subResult.rows) {
      const list = subsByCategory.get(sub.category_id) || [];
      list.push({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        createdAt: sub.created_at,
        activity: sub.activity,
        activeDuelCount: sub.active_duel_count,
      });
      subsByCategory.set(sub.category_id, list);
    }

    const categories = catResult.rows.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      subcategories: subsByCategory.get(cat.id) || [],
      activeDuelCount: (subsByCategory.get(cat.id) || []).reduce((sum: number, s: any) => sum + s.activeDuelCount, 0),
    }));

    return res.json({ categories });
  } catch (err: any) {
    console.error('[categories] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
