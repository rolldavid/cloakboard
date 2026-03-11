/**
 * Subcategories API
 * POST /api/subcategories — create a user-defined subcategory
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import { requireUserAuth, type AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.post('/', requireUserAuth, async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user!;

  const { categoryId, name } = req.body;

  if (!categoryId || !name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'categoryId and name required' });
  }

  const trimmed = name.trim();

  if (trimmed.length > 30) {
    return res.status(400).json({ error: 'Subcategory name must be 30 characters or fewer' });
  }

  if (trimmed.split(/\s+/).length > 3) {
    return res.status(400).json({ error: 'Subcategory name must be 1-3 words' });
  }

  if (/[?!]/.test(trimmed) || /^(should|will|can|is|are|do|does|has|have|would|could)\b/i.test(trimmed)) {
    return res.status(400).json({ error: 'Subcategory name should be a topic, not a question' });
  }

  // Generate slug from name
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

  if (!slug) {
    return res.status(400).json({ error: 'Invalid name' });
  }

  try {
    // Verify category exists
    const catCheck = await pool.query('SELECT 1 FROM categories WHERE id = $1', [categoryId]);
    if (catCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Category not found' });
    }

    const result = await pool.query(
      `INSERT INTO subcategories (category_id, name, slug, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, category_id, name, slug, created_at`,
      [categoryId, name.trim(), slug, user.address],
    );

    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      categoryId: row.category_id,
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at,
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Subcategory already exists in this category' });
    }
    console.error('[subcategories:post] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to create subcategory' });
  }
});

export default router;
