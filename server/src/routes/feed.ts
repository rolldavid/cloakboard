/**
 * GET /api/duels/feed — Paginated duel feed with sorting.
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

router.get('/', async (req: Request, res: Response) => {
  const sort = (req.query.sort as string) || 'best';
  const time = (req.query.time as string) || 'all';
  const cloak = req.query.cloak as string | undefined;
  const cursor = parseInt((req.query.cursor as string) || '0', 10);
  const limit = Math.min(parseInt((req.query.limit as string) || '25', 10), 100);
  const viewer = req.query.viewer as string | undefined;

  try {
    const params: any[] = [];
    let paramIdx = 1;

    // Build time filter for "top" sort
    let timeFilter = '';
    if (sort === 'top' && time !== 'all') {
      const intervals: Record<string, string> = {
        day: '1 day',
        week: '7 days',
        month: '30 days',
        year: '365 days',
      };
      const interval = intervals[time];
      if (interval) {
        timeFilter = ` AND ds.created_at >= NOW() - INTERVAL '${interval}'`;
      }
    }

    // Cloak filter
    let cloakFilter = '';
    if (cloak) {
      params.push(cloak);
      cloakFilter = ` AND (ds.cloak_address = $${paramIdx} OR ds.cloak_slug = $${paramIdx})`;
      paramIdx++;
    }

    // Viewer star join
    let viewerStarSelect = ', false AS is_starred';
    let viewerStarJoin = '';
    if (viewer) {
      params.push(viewer);
      viewerStarSelect = `, COALESCE(vs.user_address IS NOT NULL, false) AS is_starred`;
      viewerStarJoin = ` LEFT JOIN duel_stars vs ON vs.cloak_address = ds.cloak_address AND vs.duel_id = ds.duel_id AND vs.user_address = $${paramIdx}`;
      paramIdx++;
    }

    // Sort clause
    let sortClause = '';
    let extraFilter = '';
    switch (sort) {
      case 'hot':
        sortClause = `(ds.total_votes + COALESCE(cc.comment_count, 0) * 2) / POWER(EXTRACT(EPOCH FROM NOW() - ds.created_at)/3600 + 2, 1.5) DESC`;
        break;
      case 'controversial':
        extraFilter = ' AND ds.total_votes >= 10';
        sortClause = `ds.total_votes * (1 - ABS((ds.agree_votes::float / NULLIF(ds.total_votes, 0) - 0.5) * 2)) DESC`;
        break;
      case 'ending_soon':
        extraFilter = ' AND ds.is_tallied = false';
        sortClause = `ds.end_block ASC`;
        break;
      case 'top':
        sortClause = `ds.total_votes DESC`;
        break;
      case 'best':
      default: {
        // Blended score
        const hotScore = `(ds.total_votes + COALESCE(cc.comment_count, 0) * 2) / POWER(EXTRACT(EPOCH FROM NOW() - ds.created_at)/3600 + 2, 1.5)`;
        const controversyBonus = `CASE WHEN ds.total_votes >= 10 THEN (1 - ABS((ds.agree_votes::float / NULLIF(ds.total_votes, 0) - 0.5) * 2)) * 0.5 ELSE 0 END`;
        const endingSoonBonus = `CASE WHEN ds.is_tallied = false AND ds.end_block > ds.start_block THEN 1.0 / (ds.end_block - ds.start_block + 1) ELSE 0 END`;
        const starredBoost = viewer ? `CASE WHEN vs.user_address IS NOT NULL THEN 3.0 ELSE 0 END` : '0';
        sortClause = `(${starredBoost} + ${hotScore} + ${controversyBonus} + ${endingSoonBonus}) DESC`;
        break;
      }
    }

    // Pagination params
    params.push(limit);
    const limitParam = `$${paramIdx}`;
    paramIdx++;
    params.push(cursor);
    const offsetParam = `$${paramIdx}`;
    paramIdx++;

    const query = `
      SELECT
        ds.cloak_address,
        ds.cloak_name,
        ds.cloak_slug,
        ds.duel_id,
        ds.statement_text,
        ds.start_block,
        ds.end_block,
        ds.total_votes,
        ds.agree_votes,
        ds.disagree_votes,
        ds.is_tallied,
        COALESCE(sc.star_count, 0)::int AS star_count,
        COALESCE(cc.comment_count, 0)::int AS comment_count,
        ds.created_at
        ${viewerStarSelect}
      FROM duel_snapshots ds
      LEFT JOIN (
        SELECT cloak_address, duel_id, COUNT(*)::int AS star_count
        FROM duel_stars GROUP BY cloak_address, duel_id
      ) sc ON sc.cloak_address = ds.cloak_address AND sc.duel_id = ds.duel_id
      LEFT JOIN (
        SELECT cloak_address, duel_id, COUNT(*)::int AS comment_count
        FROM comments WHERE is_deleted = false GROUP BY cloak_address, duel_id
      ) cc ON cc.cloak_address = ds.cloak_address AND cc.duel_id = ds.duel_id
      ${viewerStarJoin}
      WHERE 1=1 ${cloakFilter} ${timeFilter} ${extraFilter}
      ORDER BY ${sortClause}
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query(query, params);

    const duels = result.rows.map((row) => ({
      cloakAddress: row.cloak_address,
      cloakName: row.cloak_name,
      cloakSlug: row.cloak_slug,
      duelId: row.duel_id,
      statementText: row.statement_text,
      startBlock: row.start_block,
      endBlock: row.end_block,
      totalVotes: row.total_votes,
      agreeVotes: row.agree_votes,
      disagreeVotes: row.disagree_votes,
      isTallied: row.is_tallied,
      starCount: row.star_count,
      commentCount: row.comment_count,
      isStarred: row.is_starred ?? false,
      createdAt: row.created_at,
    }));

    const nextCursor = result.rows.length === limit ? String(cursor + limit) : null;

    res.setHeader('Cache-Control', 'no-cache');
    return res.json({ duels, nextCursor });
  } catch (err: any) {
    console.error('[feed] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
