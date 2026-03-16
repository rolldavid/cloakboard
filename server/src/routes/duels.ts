/**
 * Duels API — CRUD + search + chart data for the restructured duel system.
 *
 * GET  /api/duels                — paginated feed with filters
 * GET  /api/duels/featured       — most active duel
 * GET  /api/duels/trending       — top trending duels
 * GET  /api/duels/search         — full-text search
 * GET  /api/duels/:id            — single duel with options/levels/periods
 * GET  /api/duels/:id/chart      — time-filtered vote snapshots
 * POST /api/duels                — create duel (+ fire-and-forget on-chain creation)
 * POST /api/duels/:id/options    — add option to multi-item duel
 * POST /api/duels/:id/sync       — sync vote tallies from on-chain
 *
 * Voting is fully on-chain (private IVC proofs) — no server vote endpoint.
 */

import { Router, type Request, type Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { pool } from '../lib/db/pool.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { createDuelOnChain } from '../lib/keeper/createDuelOnChain.js';
import { readDuelDirect, readDuelCount, readOptionVoteCount, readLevelVoteCount, readUserEligibility } from '../lib/aztec/publicStorageReader.js';
import { getNode } from '../lib/keeper/wallet.js';
import { getBlockClock, refreshBlockClock } from '../lib/blockClock.js';
import { AztecAddress } from '@aztec/aztec.js/addresses';

// Circuit breaker for eligibility check — fail closed after sustained node failures
let _eligibilityFailCount = 0;
import { computeCalendarPeriodEnd, generatePeriodSlug } from '../lib/calendarPeriods.js';
import { checkProfanity } from '../lib/profanityFilter.js';

const router = Router();

/** Generate a URL-safe slug from a title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')      // trim leading/trailing hyphens
    .slice(0, 80);                 // cap length
}

/** Generate a unique slug, appending a random suffix if needed. */
async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || 'duel';
  // Try the base slug first
  const check = await pool.query('SELECT 1 FROM duels WHERE slug = $1', [base]);
  if (check.rowCount === 0) return base;
  // Append random digits until unique (max 5 attempts)
  for (let i = 0; i < 5; i++) {
    const suffix = Math.floor(Math.random() * 9000 + 1000); // 4-digit random
    const candidate = `${base}-${suffix}`;
    const check2 = await pool.query('SELECT 1 FROM duels WHERE slug = $1', [candidate]);
    if (check2.rowCount === 0) return candidate;
  }
  // Fallback: use timestamp
  return `${base}-${Date.now()}`;
}

function getUser(req: AuthenticatedRequest) {
  return req.user;
}

// ─── GET /api/duels ───────────────────────────────────────────────
/**
 * GET /api/duels/slug-map
 * Lightweight map of all duels: { [dbId]: { slug, title } }
 * Public data, no auth. Used by positions page to resolve duel links privately
 * (the client matches db_duel_id from on-chain VoteStakeNotes against this map).
 */
router.get('/slug-map', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT id, slug, title FROM duels ORDER BY id DESC LIMIT 5000');
    const map: Record<number, { slug: string; title: string }> = {};
    for (const row of result.rows) {
      map[row.id] = { slug: row.slug, title: row.title };
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(map);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch slug map' });
  }
});

router.get('/', async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const subcategory = req.query.subcategory as string | undefined;
  const sort = (req.query.sort as string) || 'trending';
  const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
  const limit = Math.min(parseInt((req.query.limit as string) || '24', 10), 100);
  const offset = (page - 1) * limit;
  const duelType = req.query.type as string | undefined;

  try {
    const params: any[] = [];
    let paramIdx = 1;
    const filters: string[] = [];

    // Subcategory filter with parent-category backfill when no category specified
    let subcategoryBackfill = false;
    let subcategorySlugForOrder: string | undefined;
    if (subcategory && !category) {
      // Backfill: filter by parent category, prioritize the selected subcategory
      const parentRes = await pool.query(
        `SELECT c.id FROM subcategories s JOIN categories c ON c.id = s.category_id WHERE s.slug = $1`,
        [subcategory],
      );
      if (parentRes.rows.length > 0) {
        params.push(parentRes.rows[0].id);
        filters.push(`c.id = $${paramIdx}`);
        paramIdx++;
        subcategoryBackfill = true;
        subcategorySlugForOrder = subcategory;
        // slug added to params later (after WHERE params) for ORDER BY only
      }
    } else {
      // Category filter (by slug)
      if (category) {
        params.push(category);
        filters.push(`c.slug = $${paramIdx}`);
        paramIdx++;
      }

      // Subcategory filter (by slug)
      if (subcategory) {
        params.push(subcategory);
        filters.push(`s.slug = $${paramIdx}`);
        paramIdx++;
      }
    }

    // Duel type filter
    if (duelType && ['binary', 'multi', 'level'].includes(duelType)) {
      params.push(duelType);
      filters.push(`d.duel_type = $${paramIdx}`);
      paramIdx++;
    }

    // Breaking filter
    const breaking = req.query.breaking as string | undefined;
    if (breaking === 'true') {
      filters.push(`d.is_breaking = true`);
    } else if (sort === 'new' || sort === 'ending') {
      // Exclude breaking duels from New/Ending feeds (they appear in Trending/Controversial + Breaking page)
      filters.push(`(d.is_breaking IS NOT TRUE)`);
    }

    // Only active duels by default, and only live duels (queue system)
    filters.push(`d.status = 'active'`);
    filters.push(`(d.queue_status = 'live' OR d.queue_status IS NULL)`);

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    // Snapshot WHERE params count before adding ORDER BY / LIMIT / OFFSET params
    const whereParamCount = params.length;

    // Add subcategory slug param for ORDER BY (not part of WHERE)
    let subcategorySlugParam = 0;
    if (subcategoryBackfill && subcategorySlugForOrder) {
      params.push(subcategorySlugForOrder);
      subcategorySlugParam = paramIdx;
      paramIdx++;
    }

    // Sort clause
    let orderClause: string;
    switch (sort) {
      case 'new':
        orderClause = 'd.created_at DESC';
        break;
      case 'controversial':
        orderClause = `CASE WHEN d.total_votes >= 2 AND d.duel_type = 'binary'
          THEN (1 - ABS((d.agree_count::float / NULLIF(d.total_votes, 0) - 0.5) * 2))
          ELSE 0 END DESC, d.total_votes DESC`;
        break;
      case 'ending':
        orderClause = `CASE WHEN d.ends_at IS NOT NULL AND d.ends_at > NOW() THEN d.ends_at ELSE '9999-12-31'::timestamptz END ASC`;
        break;
      case 'trending':
      default:
        // Hot score: votes / time decay + comment engagement (2x boost for breaking)
        orderClause = `(d.total_votes + d.comment_count * 2) * CASE WHEN d.is_breaking THEN 2 ELSE 1 END / POWER(EXTRACT(EPOCH FROM NOW() - d.created_at)/3600 + 2, 1.5) DESC`;
        break;
    }

    params.push(limit);
    const limitParam = paramIdx++;
    params.push(offset);
    const offsetParam = paramIdx++;

    const query = `
      SELECT
        d.id, d.slug, d.on_chain_id, d.title, d.description, d.duel_type, d.timing_type,
        d.ends_at, d.starts_at, d.duration_seconds, d.recurrence, d.status,
        d.agree_count, d.disagree_count, d.total_votes, d.comment_count,
        d.created_at, d.created_by, d.level_low_label, d.level_high_label, d.chart_mode, d.chart_top_n, d.end_block,
        d.is_breaking, d.breaking_source_url, d.breaking_headline, d.breaking_image_url,
        d.queue_status, d.staked_amount, d.staker_address, d.stake_multiplier, d.stake_status, d.stake_reward,
        d.winning_direction, d.finalized_at,
        s.id AS subcategory_id, s.name AS subcategory_name, s.slug AS subcategory_slug,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        (SELECT json_agg(json_build_object('id', o.id, 'label', o.label, 'voteCount', o.vote_count) ORDER BY o.vote_count DESC)
         FROM duel_options o WHERE o.duel_id = d.id) AS options,
        (SELECT json_agg(json_build_object('level', l.level, 'voteCount', l.vote_count, 'label', l.label) ORDER BY l.level)
         FROM duel_levels l WHERE l.duel_id = d.id) AS levels
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      ${whereClause}
      ORDER BY ${subcategoryBackfill ? `CASE WHEN s.slug = $${subcategorySlugParam} THEN 0 ELSE 1 END,` : ''} ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(query, params);

    // Total count for pagination — only pass WHERE params (not ORDER BY slug / LIMIT / OFFSET)
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params.slice(0, whereParamCount));

    const duels = result.rows.map(formatDuel);

    res.setHeader('Cache-Control', 'no-cache');
    return res.json({
      duels,
      total: countResult.rows[0].total,
      page,
      pageSize: limit,
    });
  } catch (err: any) {
    console.error('[duels:list] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch duels' });
  }
});

// ─── GET /api/duels/featured ──────────────────────────────────────
// Returns all 4 featured duels (one per sort), deduplicated by priority:
//   trending (pinned or computed) > controversial > new > ending
router.get('/featured', async (req: Request, res: Response) => {
  try {
    const categoryFilter = req.query.category as string | undefined;
    const pinnedId = process.env.FEATURED_DUEL_ID ? parseInt(process.env.FEATURED_DUEL_ID, 10) : null;

    const selectCols = `
        d.id, d.slug, d.on_chain_id, d.title, d.description, d.duel_type, d.timing_type,
        d.ends_at, d.starts_at, d.duration_seconds, d.recurrence, d.status,
        d.agree_count, d.disagree_count, d.total_votes, d.comment_count,
        d.created_at, d.created_by, d.level_low_label, d.level_high_label, d.chart_mode, d.chart_top_n, d.end_block,
        d.is_breaking, d.breaking_source_url, d.breaking_headline, d.breaking_image_url,
        d.queue_status, d.staked_amount, d.staker_address, d.stake_multiplier, d.stake_status, d.stake_reward,
        d.winning_direction, d.finalized_at,
        s.id AS subcategory_id, s.name AS subcategory_name, s.slug AS subcategory_slug,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        (SELECT json_agg(json_build_object('id', o.id, 'label', o.label, 'voteCount', o.vote_count) ORDER BY o.vote_count DESC)
         FROM duel_options o WHERE o.duel_id = d.id) AS options,
        (SELECT json_agg(json_build_object('level', l.level, 'voteCount', l.vote_count, 'label', l.label) ORDER BY l.level)
         FROM duel_levels l WHERE l.duel_id = d.id) AS levels
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id`;

    // Featured trending uses steeper decay after 12h to ensure rotation
    const trendingFeaturedOrder = `(d.total_votes + d.comment_count * 2) * CASE WHEN d.is_breaking THEN 2 ELSE 1 END
      / POWER(EXTRACT(EPOCH FROM NOW() - d.created_at)/3600 + 2, 1.5)
      / CASE WHEN EXTRACT(EPOCH FROM NOW() - d.created_at) > 43200 THEN
          POWER(EXTRACT(EPOCH FROM NOW() - d.created_at) / 43200, 2)
        ELSE 1 END
      DESC`;

    const orderBys: Record<string, string> = {
      trending: '(d.total_votes + d.comment_count * 2) * CASE WHEN d.is_breaking THEN 2 ELSE 1 END / POWER(EXTRACT(EPOCH FROM NOW() - d.created_at)/3600 + 2, 1.5) DESC',
      controversial: `CASE WHEN d.total_votes >= 2 AND d.duel_type = 'binary'
        THEN (1 - ABS((d.agree_count::float / NULLIF(d.total_votes, 0) - 0.5) * 2))
        ELSE 0 END DESC, d.total_votes DESC`,
      new: 'd.created_at DESC',
      ending: `CASE WHEN d.ends_at IS NOT NULL AND d.ends_at > NOW()
        THEN d.ends_at ELSE '9999-12-31'::timestamptz END ASC`,
    };

    // Helper: fetch top duel for a sort, excluding already-picked IDs, with optional extra filter
    async function pickFeatured(sort: string, excludeIds: number[], extraFilter = '', useRotation = false): Promise<any> {
      const params: any[] = [...excludeIds];
      const excludeClause = excludeIds.length > 0
        ? `AND d.id NOT IN (${excludeIds.map((_, i) => `$${i + 1}`).join(',')})`
        : '';
      let catClause = '';
      if (categoryFilter) {
        params.push(categoryFilter);
        catClause = `AND c.slug = $${params.length}`;
      }
      const order = (useRotation && sort === 'trending') ? trendingFeaturedOrder : orderBys[sort];
      const result = await pool.query(
        `SELECT ${selectCols} WHERE d.status = 'active' AND (d.queue_status = 'live' OR d.queue_status IS NULL) ${catClause} ${excludeClause} ${extraFilter} ORDER BY ${order} LIMIT 1`,
        params
      );
      return result.rows.length > 0 ? formatDuel(result.rows[0]) : null;
    }

    const picked: number[] = [];

    // 1. Breaking (highest priority)
    const breaking = await pickFeatured('trending', picked, 'AND d.is_breaking = true', true);
    if (breaking) picked.push(breaking.id);

    // 2. Trending (needs breaking excluded)
    let trending = null;
    if (pinnedId) {
      const pinnedParams: any[] = [pinnedId];
      let pinnedCatClause = '';
      if (categoryFilter) {
        pinnedParams.push(categoryFilter);
        pinnedCatClause = `AND c.slug = $${pinnedParams.length}`;
      }
      const pinned = await pool.query(`SELECT ${selectCols} WHERE d.id = $1 AND d.status = 'active' AND (d.queue_status = 'live' OR d.queue_status IS NULL) ${pinnedCatClause} LIMIT 1`, pinnedParams);
      if (pinned.rows.length > 0) trending = formatDuel(pinned.rows[0]);
    }
    if (!trending) trending = await pickFeatured('trending', picked, 'AND (d.is_breaking IS NOT TRUE)', true);
    if (trending) picked.push(trending.id);

    // 3. Controversial, New, Ending — run in parallel (all exclude same set)
    const [controversial, newDuel, ending] = await Promise.all([
      pickFeatured('controversial', picked, 'AND (d.is_breaking IS NOT TRUE)'),
      pickFeatured('new', picked, 'AND (d.is_breaking IS NOT TRUE)'),
      pickFeatured('ending', picked, 'AND (d.is_breaking IS NOT TRUE)'),
    ]);

    return res.json({ trending, controversial, new: newDuel, ending, breaking });
  } catch (err: any) {
    console.error('[duels:featured] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch featured duels' });
  }
});

// ─── GET /api/duels/trending ──────────────────────────────────────
router.get('/trending', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      WITH recent_snapshots AS (
        SELECT DISTINCT ON (duel_id)
          duel_id, total_votes AS latest_votes
        FROM vote_snapshots
        ORDER BY duel_id, snapshot_at DESC
      ),
      old_snapshots AS (
        SELECT DISTINCT ON (duel_id)
          duel_id, total_votes AS old_votes
        FROM vote_snapshots
        WHERE snapshot_at <= NOW() - INTERVAL '24 hours'
        ORDER BY duel_id, snapshot_at DESC
      ),
      recent_comment_counts AS (
        SELECT duel_id, count(*)::int AS recent_comments
        FROM comments
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY duel_id
      )
      SELECT
        d.id, d.slug, d.title, d.duel_type, d.total_votes, d.comment_count,
        d.agree_count, d.disagree_count, d.is_breaking,
        c.name AS category_name, c.slug AS category_slug,
        GREATEST(COALESCE(rs.latest_votes, 0) - COALESCE(os.old_votes, 0), 0) AS recent_votes,
        COALESCE(rc.recent_comments, 0) AS recent_comments
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN recent_snapshots rs ON rs.duel_id = d.id
      LEFT JOIN old_snapshots os ON os.duel_id = d.id
      LEFT JOIN recent_comment_counts rc ON rc.duel_id = d.id
      WHERE d.status = 'active' AND (d.queue_status = 'live' OR d.queue_status IS NULL)
      ORDER BY (GREATEST(COALESCE(rs.latest_votes, 0) - COALESCE(os.old_votes, 0), 0) + COALESCE(rc.recent_comments, 0) * 2 + d.total_votes * 0.1) * CASE WHEN d.is_breaking THEN 2 ELSE 1 END DESC
      LIMIT 10
    `);

    const trending = result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      duelType: row.duel_type,
      totalVotes: row.total_votes,
      commentCount: row.comment_count,
      agreeCount: row.agree_count,
      disagreeCount: row.disagree_count,
      categoryName: row.category_name,
      categorySlug: row.category_slug,
      isBreaking: row.is_breaking || false,
    }));

    return res.json({ trending });
  } catch (err: any) {
    console.error('[duels:trending] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch trending' });
  }
});

// ─── GET /api/duels/recently-ended ────────────────────────────────
// Returns recently ended duels sorted by activity-weighted recency.
// Includes winner info for each duel type.
router.get('/recently-ended', async (req: Request, res: Response) => {
  try {
    const category = (req.query.category as string) || '';
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;

    const filters: string[] = [
      `d.status = 'ended'`,
      `d.total_votes >= 1`,
    ];
    const params: any[] = [];

    // Only apply 7-day window for sidebar (no category, default limit)
    if (!category && limit <= 10) {
      filters.push(`d.ends_at >= NOW() - INTERVAL '7 days'`);
    }

    if (category) {
      params.push(category);
      filters.push(`c.slug = $${params.length}`);
    }

    const whereClause = filters.join(' AND ');

    // For paginated results, sort by recency; for sidebar, sort by activity-weighted recency
    const orderBy = category || limit > 10
      ? `d.ends_at DESC`
      : `(
        (d.total_votes + d.comment_count * 2)
        / POWER(EXTRACT(EPOCH FROM NOW() - d.ends_at) / 3600 + 1, 0.8)
      ) DESC`;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM duels d
       LEFT JOIN subcategories s ON s.id = d.subcategory_id
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].count;

    const result = await pool.query(`
      SELECT
        d.id, d.slug, d.title, d.duel_type, d.timing_type,
        d.total_votes, d.comment_count,
        d.agree_count, d.disagree_count, d.ends_at, d.created_at, d.duration_seconds,
        d.is_breaking, d.level_low_label, d.level_high_label,
        c.name AS category_name, c.slug AS category_slug,
        (SELECT json_agg(json_build_object('id', o.id, 'label', o.label, 'voteCount', o.vote_count) ORDER BY o.vote_count DESC)
         FROM duel_options o WHERE o.duel_id = d.id) AS options,
        (SELECT json_agg(json_build_object('level', l.level, 'voteCount', l.vote_count, 'label', l.label) ORDER BY l.level)
         FROM duel_levels l WHERE l.duel_id = d.id) AS levels
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const duels = result.rows.map((row: any) => {
      const options = row.options || [];
      const levels = row.levels || [];

      // Determine winner based on duel type
      let winner: string | null = null;
      let winnerPct: number | null = null;
      if (row.duel_type === 'binary' && row.total_votes > 0) {
        if (row.agree_count > row.disagree_count) {
          winner = 'Agree';
          winnerPct = Math.round((row.agree_count / row.total_votes) * 100);
        } else if (row.disagree_count > row.agree_count) {
          winner = 'Disagree';
          winnerPct = Math.round((row.disagree_count / row.total_votes) * 100);
        } else {
          winner = 'Tie';
          winnerPct = 50;
        }
      } else if (row.duel_type === 'multi' && options.length > 0) {
        const top = options[0]; // already sorted by vote_count DESC
        winner = top.label;
        winnerPct = row.total_votes > 0 ? Math.round((top.voteCount / row.total_votes) * 100) : null;
      } else if (row.duel_type === 'level' && levels.length > 0) {
        // Find level with most votes
        const topLevel = [...levels].sort((a: any, b: any) => b.voteCount - a.voteCount)[0];
        winner = topLevel.label || `Level ${topLevel.level}`;
        winnerPct = row.total_votes > 0 ? Math.round((topLevel.voteCount / row.total_votes) * 100) : null;
      }

      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        duelType: row.duel_type,
        timingType: row.timing_type,
        totalVotes: row.total_votes,
        agreeCount: row.agree_count,
        disagreeCount: row.disagree_count,
        categoryName: row.category_name,
        categorySlug: row.category_slug,
        isBreaking: row.is_breaking || false,
        endsAt: row.ends_at,
        createdAt: row.created_at,
        durationSeconds: row.duration_seconds,
        winner,
        winnerPct,
      };
    });

    return res.json({ duels, total, page, pageSize: limit });
  } catch (err: any) {
    console.error('[duels:recently-ended] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch recently ended duels' });
  }
});

// ─── GET /api/duels/search ────────────────────────────────────────
router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  const page = Math.max(parseInt((req.query.page as string) || '1', 10), 1);
  const limit = Math.min(parseInt((req.query.limit as string) || '24', 10), 100);
  const offset = (page - 1) * limit;

  if (!q || q.length < 2) {
    return res.json({ duels: [], total: 0 });
  }

  try {
    // Convert to tsquery-safe format — strip non-alphanumeric chars to prevent injection
    const tsQuery = q.split(/\s+/).filter(Boolean)
      .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(w => w.length > 0)
      .map(w => w + ':*').join(' & ');
    if (!tsQuery) return res.json({ duels: [], total: 0 });

    const result = await pool.query(`
      SELECT
        d.id, d.slug, d.on_chain_id, d.title, d.description, d.duel_type, d.timing_type,
        d.ends_at, d.starts_at, d.duration_seconds, d.recurrence, d.status,
        d.agree_count, d.disagree_count, d.total_votes, d.comment_count,
        d.created_at, d.created_by, d.level_low_label, d.level_high_label, d.chart_mode, d.chart_top_n, d.end_block,
        d.is_breaking, d.breaking_source_url, d.breaking_headline, d.breaking_image_url,
        d.queue_status, d.staked_amount, d.staker_address, d.stake_multiplier, d.stake_status, d.stake_reward,
        d.winning_direction, d.finalized_at,
        s.id AS subcategory_id, s.name AS subcategory_name, s.slug AS subcategory_slug,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        (SELECT json_agg(json_build_object('id', o.id, 'label', o.label, 'voteCount', o.vote_count) ORDER BY o.vote_count DESC)
         FROM duel_options o WHERE o.duel_id = d.id) AS options,
        (SELECT json_agg(json_build_object('level', l.level, 'voteCount', l.vote_count, 'label', l.label) ORDER BY l.level)
         FROM duel_levels l WHERE l.duel_id = d.id) AS levels,
        ts_rank(to_tsvector('english', d.title || ' ' || COALESCE(d.description, '')), to_tsquery('english', $1)) AS rank
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE to_tsvector('english', d.title || ' ' || COALESCE(d.description, '')) @@ to_tsquery('english', $1)
      ORDER BY CASE WHEN d.status = 'active' THEN 0 ELSE 1 END, rank DESC, d.total_votes DESC
      LIMIT $2 OFFSET $3
    `, [tsQuery, limit, offset]);

    const countResult = await pool.query(`
      SELECT COUNT(*)::int AS total FROM duels d
      WHERE to_tsvector('english', d.title || ' ' || COALESCE(d.description, '')) @@ to_tsquery('english', $1)
    `, [tsQuery]);

    return res.json({
      duels: result.rows.map(formatDuel),
      total: countResult.rows[0].total,
    });
  } catch (err: any) {
    console.error('[duels:search] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to search duels' });
  }
});

// ─── GET /api/duels/:id ──────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const param = req.params.id;
  const isNumeric = /^\d+$/.test(param);

  try {
    const result = await pool.query(`
      SELECT
        d.id, d.slug, d.on_chain_id, d.title, d.description, d.duel_type, d.timing_type,
        d.ends_at, d.starts_at, d.duration_seconds, d.recurrence, d.status,
        d.agree_count, d.disagree_count, d.total_votes, d.comment_count,
        d.created_at, d.created_by, d.level_low_label, d.level_high_label, d.chart_mode, d.chart_top_n, d.end_block,
        d.is_breaking, d.breaking_source_url, d.breaking_headline, d.breaking_image_url,
        d.queue_status, d.staked_amount, d.staker_address, d.stake_multiplier, d.stake_status, d.stake_reward,
        d.winning_direction, d.finalized_at,
        s.id AS subcategory_id, s.name AS subcategory_name, s.slug AS subcategory_slug,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug
      FROM duels d
      LEFT JOIN subcategories s ON s.id = d.subcategory_id
      LEFT JOIN categories c ON c.id = s.category_id
      WHERE ${isNumeric ? 'd.id = $1' : 'd.slug = $1'}
    `, [isNumeric ? parseInt(param, 10) : param]);
    const duelId = result.rows.length > 0 ? result.rows[0].id : 0;

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Duel not found' });
    }

    const duel = formatDuel(result.rows[0]);

    // V9: Compute stake costs from current tallies
    const totalVotes = duel.totalVotes || 0;
    if (duel.duelType === 'binary') {
      const agree = duel.agreeCount || 0;
      const disagree = duel.disagreeCount || 0;
      if (totalVotes === 0) {
        duel.stakeCosts = { agree: 50, disagree: 50 };
      } else {
        const agreeStake = Math.max(5, Math.round(100 * agree / totalVotes));
        duel.stakeCosts = { agree: agreeStake, disagree: Math.max(5, 100 - agreeStake) };
      }
    }

    // Fetch options for multi duels
    if (duel.duelType === 'multi') {
      const optResult = await pool.query(
        `SELECT id, label, vote_count, added_by, created_at FROM duel_options WHERE duel_id = $1 ORDER BY vote_count DESC`,
        [duelId],
      );
      duel.options = optResult.rows.map((o) => ({
        id: o.id,
        label: o.label,
        voteCount: o.vote_count,
        addedBy: o.added_by,
        createdAt: o.created_at,
      }));

      // V9: Compute stake costs for multi-option duels
      if (totalVotes === 0) {
        duel.stakeCosts = { options: Object.fromEntries(duel.options.map((_: any, i: number) => [i, 50])) };
      } else {
        duel.stakeCosts = {
          options: Object.fromEntries(duel.options.map((o: any, i: number) => [
            i, Math.max(5, Math.round(100 * o.voteCount / totalVotes)),
          ])),
        };
      }
    }

    // Fetch levels for level duels
    if (duel.duelType === 'level') {
      const lvlResult = await pool.query(
        `SELECT level, vote_count, label FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
        [duelId],
      );
      duel.levels = lvlResult.rows.map((l) => ({
        level: l.level,
        voteCount: l.vote_count,
        label: l.label || null,
      }));

      // V9: Compute stake costs for level duels
      if (totalVotes === 0) {
        duel.stakeCosts = { levels: Object.fromEntries(duel.levels.map((l: any) => [l.level, 50])) };
      } else {
        duel.stakeCosts = {
          levels: Object.fromEntries(duel.levels.map((l: any) => [
            l.level, Math.max(5, Math.round(100 * l.voteCount / totalVotes)),
          ])),
        };
      }
    }

    // Fetch periods for recurring duels (enriched with slug, endBlock, status, per-period votes)
    if (duel.timingType === 'recurring') {
      const perResult = await pool.query(
        `SELECT id, period_start, period_end, on_chain_id, agree_count, disagree_count, total_votes, slug, end_block, status
         FROM duel_periods WHERE duel_id = $1 ORDER BY period_start DESC`,
        [duelId],
      );

      const periodIds = perResult.rows.map((p: any) => p.id);

      // Batch-load per-period option votes (avoids N+1)
      let optsByPeriod = new Map<number, any[]>();
      if (duel.duelType === 'multi' && periodIds.length > 0) {
        const allPeriodOpts = await pool.query(
          `SELECT pov.period_id, pov.option_id AS id, do2.label, pov.vote_count
           FROM period_option_votes pov
           JOIN duel_options do2 ON do2.id = pov.option_id
           WHERE pov.period_id = ANY($1)
           ORDER BY pov.vote_count DESC`,
          [periodIds],
        );
        for (const row of allPeriodOpts.rows) {
          if (!optsByPeriod.has(row.period_id)) optsByPeriod.set(row.period_id, []);
          optsByPeriod.get(row.period_id)!.push({ id: row.id, label: row.label, voteCount: row.vote_count });
        }
      }

      // Batch-load per-period level votes (avoids N+1)
      let lvlsByPeriod = new Map<number, any[]>();
      if (duel.duelType === 'level' && periodIds.length > 0) {
        const allPeriodLvls = await pool.query(
          `SELECT plv.period_id, plv.level, plv.vote_count, dl.label
           FROM period_level_votes plv
           LEFT JOIN duel_levels dl ON dl.duel_id = plv.duel_id AND dl.level = plv.level
           WHERE plv.period_id = ANY($1) AND plv.duel_id = $2
           ORDER BY plv.level`,
          [periodIds, duelId],
        );
        for (const row of allPeriodLvls.rows) {
          if (!lvlsByPeriod.has(row.period_id)) lvlsByPeriod.set(row.period_id, []);
          lvlsByPeriod.get(row.period_id)!.push({ level: row.level, voteCount: row.vote_count, label: row.label || null });
        }
      }

      const periods: any[] = [];
      for (const p of perResult.rows) {
        const period: any = {
          id: p.id,
          periodStart: p.period_start,
          periodEnd: p.period_end,
          onChainId: p.on_chain_id,
          agreeCount: p.agree_count,
          disagreeCount: p.disagree_count,
          totalVotes: p.total_votes,
          slug: p.slug,
          endBlock: p.end_block,
          status: p.status || 'active',
        };

        if (duel.duelType === 'multi') {
          period.options = optsByPeriod.get(p.id) || [];
        }
        if (duel.duelType === 'level') {
          period.levels = lvlsByPeriod.get(p.id) || [];
        }

        periods.push(period);
      }
      duel.periods = periods;
    }

    return res.json({ duel });
  } catch (err: any) {
    console.error('[duels:get] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch duel' });
  }
});

// ─── GET /api/duels/:id/chart ─────────────────────────────────────
router.get('/:id/chart', async (req: Request, res: Response) => {
  const duelId = parseInt(req.params.id, 10);
  const range = (req.query.range as string) || 'all';
  const periodId = req.query.periodId ? parseInt(req.query.periodId as string, 10) : undefined;

  if (isNaN(duelId)) {
    return res.status(400).json({ error: 'Invalid duel id' });
  }

  try {
    const params: any[] = [duelId];
    let paramIdx = 2;
    let timeFilter = '';

    if (range !== 'all') {
      const intervals: Record<string, string> = {
        '1h':  '1 hour',
        '6h':  '6 hours',
        '12h': '12 hours',
        '24h': '24 hours',
        'day': '24 hours',
        'week': '7 days',
        'month': '30 days',
        '1y': '365 days',
      };
      const interval = intervals[range];
      if (interval) {
        params.push(interval);
        timeFilter = ` AND snapshot_at >= NOW() - $${paramIdx}::interval`;
        paramIdx++;
      }
    }

    let periodFilter = '';
    if (periodId !== undefined) {
      params.push(periodId);
      periodFilter = ` AND period_id = $${paramIdx}`;
      paramIdx++;
    }

    const result = await pool.query(`
      SELECT snapshot_at, agree_count, disagree_count, total_votes, option_counts
      FROM vote_snapshots
      WHERE duel_id = $1 ${timeFilter} ${periodFilter}
      ORDER BY snapshot_at ASC
    `, params);

    const snapshots = result.rows.map((row) => ({
      snapshotAt: row.snapshot_at,
      agreeCount: row.agree_count,
      disagreeCount: row.disagree_count,
      totalVotes: row.total_votes,
      optionCounts: row.option_counts,
    }));

    // For filtered ranges, prepend an "anchor" — the last snapshot before the window.
    // This gives the chart a correct starting state instead of a missing baseline.
    if (timeFilter && snapshots.length > 0) {
      const anchorParams: any[] = [duelId];
      let anchorParamIdx = 2;
      const intervals: Record<string, string> = {
        '1h': '1 hour', '6h': '6 hours', '12h': '12 hours',
        '24h': '24 hours', day: '24 hours', week: '7 days', month: '30 days', '1y': '365 days',
      };
      const interval = intervals[range];
      if (interval) {
        anchorParams.push(interval);
        let anchorPeriodFilter = '';
        if (periodId !== undefined) {
          anchorParams.push(periodId);
          anchorPeriodFilter = ` AND period_id = $${anchorParamIdx + 1}`;
        }
        const anchorResult = await pool.query(`
          SELECT snapshot_at, agree_count, disagree_count, total_votes, option_counts
          FROM vote_snapshots
          WHERE duel_id = $1 AND snapshot_at < NOW() - $${anchorParamIdx}::interval ${anchorPeriodFilter}
          ORDER BY snapshot_at DESC LIMIT 1
        `, anchorParams);
        if (anchorResult.rows.length > 0) {
          const a = anchorResult.rows[0];
          snapshots.unshift({
            snapshotAt: a.snapshot_at,
            agreeCount: a.agree_count,
            disagreeCount: a.disagree_count,
            totalVotes: a.total_votes,
            optionCounts: a.option_counts,
          });
        }
      }
    }

    // Server-side downsampling — thin dense 1-min snapshots for larger ranges
    const strideMap: Record<string, number> = {
      '1h': 1, '6h': 4, '12h': 8, '24h': 15, day: 15, week: 120, month: 360, '1y': 1440,
    };
    let stride = strideMap[range] ?? 0;
    if (range === 'all' && snapshots.length > 150) {
      stride = Math.ceil(snapshots.length / 150);
    }
    if (stride > 1 && snapshots.length > stride) {
      const thinned: typeof snapshots = [snapshots[0]];
      for (let i = stride; i < snapshots.length - 1; i += stride) {
        thinned.push(snapshots[i]);
      }
      thinned.push(snapshots[snapshots.length - 1]); // always keep last
      return res.json({ snapshots: thinned });
    }

    return res.json({ snapshots });
  } catch (err: any) {
    console.error('[duels:chart] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// ─── POST /api/duels ──────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // On-chain eligibility check (requires certify_eligible proof)
  const userProfileAddress = process.env.VITE_USER_PROFILE_ADDRESS;
  if (userProfileAddress) {
    try {
      const node = await getNode();
      const eligible = await readUserEligibility(
        node,
        AztecAddress.fromString(userProfileAddress),
        user.address,
      );
      if (!eligible) {
        return res.status(403).json({
          error: 'Not enough whisper points to create a duel',
          code: 'POINTS_INSUFFICIENT',
        });
      }
      _eligibilityFailCount = 0; // Reset circuit breaker on successful check
    } catch (err: any) {
      // Fail open for transient errors, but track consecutive failures
      _eligibilityFailCount++;
      if (_eligibilityFailCount > 10) {
        // Too many consecutive failures — fail closed to prevent abuse
        console.error('[duels:create] Eligibility check failed (circuit breaker open):', err?.message);
        return res.status(503).json({ error: 'Voting system temporarily unavailable. Please try again later.' });
      }
      console.warn('[duels:create] Eligibility check failed, allowing creation:', err?.message);
    }
  }

  const { title, description, duelType, timingType, subcategoryId, endsAt, startsAt, durationSeconds, recurrence, options, levelLowLabel, levelHighLabel, chartMode, chartTopN, stakeAmount } = req.body;

  // Validation
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'Title required' });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or fewer' });
  }
  if (!['binary', 'multi', 'level'].includes(duelType)) {
    return res.status(400).json({ error: 'Invalid duel type' });
  }
  if (timingType && timingType !== 'duration') {
    return res.status(400).json({ error: 'Only duration timing type is supported' });
  }
  const { categoryId } = req.body;
  if (!subcategoryId && !categoryId) {
    return res.status(400).json({ error: 'Category required' });
  }

  // Multi-item duels need at least 2 options
  if (duelType === 'multi') {
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Multi-item duels require at least 2 options' });
    }
    if (options.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 options' });
    }
  }

  // Level duels need 2-10 labeled levels
  if (duelType === 'level') {
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Level duels require at least 2 levels' });
    }
    if (options.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 levels' });
    }
  }

  // Profanity check on title, description, and options/levels
  const profanityFields: Record<string, string | undefined | null> = {
    title: title?.trim(),
    description: description?.trim(),
  };
  if (Array.isArray(options)) {
    options.forEach((opt: string, i: number) => {
      profanityFields[`option ${i + 1}`] = typeof opt === 'string' ? opt.trim() : undefined;
    });
  }
  const profanityResult = checkProfanity(profanityFields);
  if (!profanityResult.clean) {
    return res.status(400).json({ error: `Inappropriate language detected in ${profanityResult.field}` });
  }

  // Validate stake amount
  const stake = typeof stakeAmount === 'number' ? stakeAmount : 10;
  if (stake < 10) {
    return res.status(400).json({ error: 'Minimum stake is 10 points' });
  }

  try {
    // Resolve subcategory — accept either subcategoryId directly or categoryId (auto-resolve)
    let resolvedSubcategoryId = subcategoryId;
    if (!resolvedSubcategoryId && categoryId) {
      const subResult = await pool.query(
        'SELECT id FROM subcategories WHERE category_id = $1 ORDER BY id LIMIT 1',
        [categoryId],
      );
      if (subResult.rows.length === 0) {
        // Auto-create a default subcategory for this category
        const catCheck = await pool.query('SELECT name FROM categories WHERE id = $1', [categoryId]);
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Category not found' });
        }
        const created = await pool.query(
          `INSERT INTO subcategories (category_id, name, slug, created_by)
           VALUES ($1, 'General', 'general', 'system')
           ON CONFLICT (category_id, slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [categoryId],
        );
        resolvedSubcategoryId = created.rows[0].id;
      } else {
        resolvedSubcategoryId = subResult.rows[0].id;
      }
    } else {
      const subCheck = await pool.query('SELECT 1 FROM subcategories WHERE id = $1', [resolvedSubcategoryId]);
      if (subCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Category not found' });
      }
    }

    // Calculate ends_at from duration
    let computedEndsAt: string | null = null;
    if (durationSeconds) {
      computedEndsAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    }

    // Compute end_block using block clock (avg block time from last 100 blocks)
    let computedEndBlock: number | null = null;
    try {
      let clock = getBlockClock();
      if (clock.blockNumber === 0) {
        const node = await getNode();
        await refreshBlockClock(node);
        clock = getBlockClock();
      }
      const currentBlock = clock.blockNumber;
      const avgBlockTime = clock.avgBlockTime || 30;

      if (computedEndsAt) {
        const endsAtMs = new Date(computedEndsAt).getTime();
        const remainingSeconds = Math.max(0, (endsAtMs - Date.now()) / 1000);
        computedEndBlock = currentBlock + Math.ceil(remainingSeconds / avgBlockTime);
      } else {
        computedEndBlock = 4294967295; // u32::MAX — never-ending
      }
    } catch (err: any) {
      console.warn('[duels:create] Block clock unavailable, end_block will be set by cron:', err?.message);
    }

    const slug = await generateUniqueSlug(title.trim());

    const { computeMultiplier } = await import('../lib/staking/stakingRewards.js');
    const stakeMultiplier = computeMultiplier(stake);

    const result = await pool.query(`
      INSERT INTO duels (title, description, duel_type, timing_type, subcategory_id, ends_at, duration_seconds, created_by, level_low_label, level_high_label, chart_mode, chart_top_n, end_block, slug, queue_status, staked_amount, staker_address, stake_multiplier, stake_status)
      VALUES ($1, $2, $3, 'duration', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'staked', $14, $7, $15, 'locked')
      RETURNING id, created_at
    `, [
      sanitizeHtml(title.trim(), { allowedTags: [], allowedAttributes: {} }),
      description ? sanitizeHtml(description.trim(), { allowedTags: [], allowedAttributes: {} }) : null,
      duelType,
      resolvedSubcategoryId,
      computedEndsAt,
      durationSeconds || null,
      user.address,
      duelType === 'level' ? (levelLowLabel?.trim() || null) : null,
      duelType === 'level' ? (levelHighLabel?.trim() || null) : null,
      duelType === 'multi' ? (chartMode || 'top_n') : null,
      duelType === 'multi' ? (chartTopN || 5) : null,
      computedEndBlock,
      slug,
      stake,
      stakeMultiplier,
    ]);

    const duelId = result.rows[0].id;

    // Create options for multi-item duels (batch insert)
    if (duelType === 'multi' && options) {
      const labels = options.map((o: string) => o.trim());
      await pool.query(
        `INSERT INTO duel_options (duel_id, label, added_by)
         SELECT $1, unnest($2::text[]), $3`,
        [duelId, labels, user.address],
      );
    }

    // Initialize levels for level vote duels (batch insert)
    if (duelType === 'level' && options) {
      const labels = options.map((o: string) => o.trim());
      const levels = options.map((_: any, i: number) => i + 1);
      await pool.query(
        `INSERT INTO duel_levels (duel_id, level, label)
         SELECT $1, unnest($2::int[]), unnest($3::text[])`,
        [duelId, levels, labels],
      );
    }

    // Insert initial snapshot
    await pool.query(
      `INSERT INTO vote_snapshots (duel_id, agree_count, disagree_count, total_votes) VALUES ($1, 0, 0, 0)`,
      [duelId],
    );

    // Log the stake
    await pool.query(
      `INSERT INTO staking_log (duel_id, staker_address, amount, action) VALUES ($1, $2, $3, 'stake')`,
      [duelId, user.address, stake],
    );

    // Fire-and-forget on-chain creation — stakingCron.promoteStakedDuels() handles this,
    // but also attempt immediately for faster go-live
    if (computedEndBlock) {
      createDuelOnChain(title.trim(), computedEndBlock)
        .then(async (onChainId) => {
          await pool.query(
            `UPDATE duels SET queue_status = 'live', status = 'active', on_chain_id = $1 WHERE id = $2`,
            [onChainId, duelId],
          );
          console.log(`[duels:create] On-chain duel created: dbId=${duelId} onChainId=${onChainId}`);
        })
        .catch((err: any) => {
          console.warn(`[duels:create] On-chain creation deferred to cron for duelId=${duelId}:`, err?.message);
        });
    }

    return res.status(201).json({ id: duelId, slug, createdAt: result.rows[0].created_at });
  } catch (err: any) {
    console.error('[duels:create] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to create duel' });
  }
});

// ─── POST /api/duels/:id/options ──────────────────────────────────
router.post('/:id/options', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user?.address) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const duelId = parseInt(req.params.id, 10);
  if (isNaN(duelId)) {
    return res.status(400).json({ error: 'Invalid duel id' });
  }

  const { label } = req.body;
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    return res.status(400).json({ error: 'Label required' });
  }
  if (label.length > 200) {
    return res.status(400).json({ error: 'Label must be 200 characters or fewer' });
  }

  try {
    // Verify duel exists, is multi type, and requester is creator
    const duelCheck = await pool.query(
      `SELECT duel_type, status, created_by FROM duels WHERE id = $1`,
      [duelId],
    );
    if (duelCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Duel not found' });
    }
    if (duelCheck.rows[0].duel_type !== 'multi') {
      return res.status(400).json({ error: 'Can only add options to multi-item duels' });
    }
    if (duelCheck.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Duel is not active' });
    }
    if (duelCheck.rows[0].created_by !== user.address) {
      return res.status(403).json({ error: 'Only the duel creator can add options' });
    }

    // Check option count limit
    const countCheck = await pool.query(
      `SELECT COUNT(*)::int AS count FROM duel_options WHERE duel_id = $1`,
      [duelId],
    );
    if (countCheck.rows[0].count >= 50) {
      return res.status(400).json({ error: 'Maximum 50 options reached' });
    }

    const result = await pool.query(
      `INSERT INTO duel_options (duel_id, label, added_by) VALUES ($1, $2, $3) RETURNING id, label, vote_count, created_at`,
      [duelId, label.trim(), user.address],
    );

    const row = result.rows[0];
    return res.status(201).json({
      id: row.id,
      label: row.label,
      voteCount: row.vote_count,
      createdAt: row.created_at,
    });
  } catch (err: any) {
    console.error('[duels:addOption] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to add option' });
  }
});

// Helper: fetch per-option/level counts from DB for sync response enrichment
async function fetchOptionLevelCounts(duelId: number, duelType: string, periodId?: number) {
  const extra: any = {};
  if (duelType === 'multi') {
    if (periodId) {
      const r = await pool.query(
        `SELECT do2.id, do2.label, pov.vote_count
         FROM period_option_votes pov
         JOIN duel_options do2 ON do2.id = pov.option_id
         WHERE pov.period_id = $1 ORDER BY do2.id`,
        [periodId],
      );
      extra.options = r.rows.map((o: any) => ({ id: o.id, label: o.label, voteCount: o.vote_count }));
    } else {
      const r = await pool.query(
        `SELECT id, label, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY id`,
        [duelId],
      );
      extra.options = r.rows.map((o: any) => ({ id: o.id, label: o.label, voteCount: o.vote_count }));
    }
  }
  if (duelType === 'level') {
    if (periodId) {
      const r = await pool.query(
        `SELECT plv.level, plv.vote_count, dl.label
         FROM period_level_votes plv
         LEFT JOIN duel_levels dl ON dl.duel_id = plv.duel_id AND dl.level = plv.level
         WHERE plv.period_id = $1 AND plv.duel_id = $2 ORDER BY plv.level`,
        [periodId, duelId],
      );
      extra.levels = r.rows.map((l: any) => ({ level: l.level, voteCount: l.vote_count, label: l.label || null }));
    } else {
      const r = await pool.query(
        `SELECT level, vote_count, label FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
        [duelId],
      );
      extra.levels = r.rows.map((l: any) => ({ level: l.level, voteCount: l.vote_count, label: l.label || null }));
    }
  }
  return extra;
}

// ─── POST /api/duels/:id/sync ─────────────────────────────────────
router.post('/:id/sync', async (req: Request, res: Response) => {
  const duelId = parseInt(req.params.id, 10);
  const periodId = req.query.periodId ? parseInt(req.query.periodId as string, 10) : undefined;
  if (isNaN(duelId)) {
    return res.status(400).json({ error: 'Invalid duel id' });
  }

  try {
    const result = await pool.query(
      `SELECT on_chain_id, duel_type, agree_count, disagree_count, total_votes, status FROM duels WHERE id = $1`,
      [duelId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Duel not found' });
    }

    const row = result.rows[0];

    // Period-aware sync: use period's on_chain_id if provided
    let onChainId = row.on_chain_id;
    let periodRow: any = null;
    if (periodId) {
      const pResult = await pool.query(
        `SELECT on_chain_id, agree_count, disagree_count, total_votes, status FROM duel_periods WHERE id = $1 AND duel_id = $2`,
        [periodId, duelId],
      );
      if (pResult.rows.length > 0) {
        periodRow = pResult.rows[0];
        onChainId = periodRow.on_chain_id;
      }
    }

    // If duel/period has on-chain backing, read live tallies from L2
    if (onChainId !== null) {
      try {
        const node = await getNode();
        const contractAddr = AztecAddress.fromString(process.env.VITE_DUELCLOAK_ADDRESS!);

        // Guard against stale on_chain_id
        const duelCount = await readDuelCount(node, contractAddr);
        if (onChainId > duelCount) {
          if (periodId && periodRow) {
            await pool.query(`UPDATE duel_periods SET on_chain_id = NULL WHERE id = $1`, [periodId]);
          } else {
            await pool.query(`UPDATE duels SET on_chain_id = NULL WHERE id = $1`, [duelId]);
          }
          const src = periodRow || row;
          const extra1 = await fetchOptionLevelCounts(duelId, row.duel_type, periodId);
          return res.json({
            agreeCount: src.agree_count,
            disagreeCount: src.disagree_count,
            totalVotes: src.total_votes,
            status: src.status || row.status,
            ...extra1,
          });
        }

        const onChainData = await readDuelDirect(node, contractAddr, onChainId);

        // If duel hasn't been mined yet (NO_WAIT window), return cached DB data
        if (onChainData.endBlock === 0 && onChainData.startBlock === 0) {
          const src = periodRow || row;
          const extra2 = await fetchOptionLevelCounts(duelId, row.duel_type, periodId);
          return res.json({
            agreeCount: src.agree_count,
            disagreeCount: src.disagree_count,
            totalVotes: src.total_votes,
            status: src.status || row.status,
            ...extra2,
          });
        }

        if (periodId) {
          // Update period tallies
          await pool.query(
            `UPDATE duel_periods SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
            [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, periodId],
          );
          // Also update parent duel for feed display
          await pool.query(
            `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
            [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, duelId],
          );

          // Sync per-option votes for multi
          if (row.duel_type === 'multi') {
            const opts = await pool.query(
              `SELECT pov.option_id AS id, pov.vote_count FROM period_option_votes pov
               JOIN duel_options do2 ON do2.id = pov.option_id
               WHERE pov.period_id = $1 ORDER BY do2.id`,
              [periodId],
            );
            for (let i = 0; i < opts.rows.length; i++) {
              try {
                const cnt = await readOptionVoteCount(node, contractAddr, onChainId, i);
                if (cnt !== opts.rows[i].vote_count) {
                  await pool.query(`UPDATE period_option_votes SET vote_count = $1 WHERE period_id = $2 AND option_id = $3`, [cnt, periodId, opts.rows[i].id]);
                }
                // Also update parent duel_options (feed/cards read from duel_options)
                await pool.query(`UPDATE duel_options SET vote_count = $1 WHERE id = $2`, [cnt, opts.rows[i].id]);
              } catch (optErr: any) {
                console.warn(`[duels:sync] Period option ${i} read failed:`, optErr?.message);
              }
            }
          }

          // Sync per-level votes for level
          if (row.duel_type === 'level') {
            const lvls = await pool.query(
              `SELECT level, vote_count FROM period_level_votes WHERE period_id = $1 AND duel_id = $2 ORDER BY level`,
              [periodId, duelId],
            );
            for (const lvl of lvls.rows) {
              try {
                const cnt = await readLevelVoteCount(node, contractAddr, onChainId, lvl.level);
                if (cnt !== lvl.vote_count) {
                  await pool.query(`UPDATE period_level_votes SET vote_count = $1 WHERE period_id = $2 AND duel_id = $3 AND level = $4`, [cnt, periodId, duelId, lvl.level]);
                }
                // Also update parent duel_levels (feed/cards read from duel_levels)
                await pool.query(`UPDATE duel_levels SET vote_count = $1 WHERE duel_id = $2 AND level = $3`, [cnt, duelId, lvl.level]);
              } catch (lvlErr: any) {
                console.warn(`[duels:sync] Period level ${lvl.level} read failed:`, lvlErr?.message);
              }
            }
          }
        } else {
          // Non-recurring: update duel-level tallies
          await pool.query(
            `UPDATE duels SET agree_count = $1, disagree_count = $2, total_votes = $3 WHERE id = $4`,
            [onChainData.agreeVotes, onChainData.disagreeVotes, onChainData.totalVotes, duelId],
          );

          if (row.duel_type === 'multi') {
            const opts = await pool.query(
              `SELECT id, vote_count FROM duel_options WHERE duel_id = $1 ORDER BY id`,
              [duelId],
            );
            for (let i = 0; i < opts.rows.length; i++) {
              try {
                const cnt = await readOptionVoteCount(node, contractAddr, onChainId, i);
                console.log(`[duels:sync] Option ${i} (dbId=${opts.rows[i].id}): onChain=${cnt}, db=${opts.rows[i].vote_count}`);
                if (cnt !== opts.rows[i].vote_count) {
                  await pool.query(`UPDATE duel_options SET vote_count = $1 WHERE id = $2`, [cnt, opts.rows[i].id]);
                }
              } catch (optErr: any) {
                console.warn(`[duels:sync] Option ${i} read failed:`, optErr?.message);
              }
            }
          }

          if (row.duel_type === 'level') {
            const lvls = await pool.query(
              `SELECT level, vote_count FROM duel_levels WHERE duel_id = $1 ORDER BY level`,
              [duelId],
            );
            for (const lvl of lvls.rows) {
              try {
                const cnt = await readLevelVoteCount(node, contractAddr, onChainId, lvl.level);
                console.log(`[duels:sync] Level ${lvl.level}: onChain=${cnt}, db=${lvl.vote_count}`);
                if (cnt !== lvl.vote_count) {
                  await pool.query(`UPDATE duel_levels SET vote_count = $1 WHERE duel_id = $2 AND level = $3`, [cnt, duelId, lvl.level]);
                }
              } catch (lvlErr: any) {
                console.warn(`[duels:sync] Level ${lvl.level} read failed:`, lvlErr?.message);
              }
            }
          }
        }

        const extra3 = await fetchOptionLevelCounts(duelId, row.duel_type, periodId);
        return res.json({
          agreeCount: onChainData.agreeVotes,
          disagreeCount: onChainData.disagreeVotes,
          totalVotes: onChainData.totalVotes,
          status: row.status,
          ...extra3,
        });
      } catch (err: any) {
        console.warn('[duels:sync] On-chain read failed, using DB cache:', err?.message);
      }
    }

    const src = periodRow || row;
    const extra4 = await fetchOptionLevelCounts(duelId, row.duel_type, periodId);
    return res.json({
      agreeCount: src.agree_count,
      disagreeCount: src.disagree_count,
      totalVotes: src.total_votes,
      status: src.status || row.status,
      ...extra4,
    });
  } catch (err: any) {
    console.error('[duels:sync] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to sync duel' });
  }
});

// ─── Helper ──────────────────────────────────────────────────────
function formatDuel(row: any) {
  return {
    id: row.id,
    slug: row.slug || String(row.id),
    onChainId: row.on_chain_id,
    title: row.title,
    description: row.description,
    duelType: row.duel_type,
    timingType: row.timing_type,
    endsAt: row.ends_at,
    startsAt: row.starts_at || null,
    durationSeconds: row.duration_seconds,
    recurrence: row.recurrence,
    status: row.status,
    agreeCount: row.agree_count,
    disagreeCount: row.disagree_count,
    totalVotes: row.total_votes,
    commentCount: row.comment_count,
    createdAt: row.created_at,
    createdBy: row.created_by,
    subcategoryId: row.subcategory_id,
    subcategoryName: row.subcategory_name,
    subcategorySlug: row.subcategory_slug,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySlug: row.category_slug,
    options: row.options || null,
    levels: row.levels || null,
    levelLowLabel: row.level_low_label || null,
    levelHighLabel: row.level_high_label || null,
    chartMode: row.chart_mode || null,
    chartTopN: row.chart_top_n || null,
    endBlock: row.end_block || null,
    isBreaking: row.is_breaking || false,
    breakingSourceUrl: row.breaking_source_url || null,
    breakingHeadline: row.breaking_headline || null,
    breakingImageUrl: row.breaking_image_url || null,
    // Queue + staking fields
    queueStatus: row.queue_status || null,
    stakedAmount: row.staked_amount || 0,
    stakerAddress: row.staker_address || null,
    stakeMultiplier: row.stake_multiplier || 1.0,
    stakeStatus: row.stake_status || null,
    stakeReward: row.stake_reward || 0,
    // V9: Market voting fields
    winningDirection: row.winning_direction ?? null,
    finalizedAt: row.finalized_at || null,
    // Extended fields set by caller
  } as any;
}

export default router;
