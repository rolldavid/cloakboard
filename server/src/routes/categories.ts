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
      `SELECT id, category_id, name, slug, created_at FROM subcategories ORDER BY name`,
    );

    const subsByCategory = new Map<number, any[]>();
    for (const sub of subResult.rows) {
      const list = subsByCategory.get(sub.category_id) || [];
      list.push({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        createdAt: sub.created_at,
      });
      subsByCategory.set(sub.category_id, list);
    }

    const categories = catResult.rows.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      subcategories: subsByCategory.get(cat.id) || [],
    }));

    return res.json({ categories });
  } catch (err: any) {
    console.error('[categories] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

export default router;
