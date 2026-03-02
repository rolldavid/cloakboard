/**
 * GET /api/duels/feed — Paginated duel feed with sorting.
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';
import { getBlockClock } from '../lib/blockClock.js';

const router = Router();

// Votes take 40-75s (IVC proof + mining). Shift the UI-facing endTime earlier
// so votes cast at "timer = 0" still have real block time to get mined.
// On-chain end_block is unchanged — this is purely a display buffer.
const VOTE_MINING_BUFFER_MS = 90_000;

router.get('/', async (req: Request, res: Response) => {
  const sort = (req.query.sort as string) || 'best';
  const time = (req.query.time as string) || 'all';
  const cloak = req.query.cloak as string | undefined;
  const cursor = parseInt((req.query.cursor as string) || '0', 10);
  const limit = Math.min(parseInt((req.query.limit as string) || '25', 10), 100);
  const viewer = req.query.viewer as string | undefined;
  const activeOnly = req.query.active === '1';

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
        params.push(interval);
        timeFilter = ` AND ds.created_at >= NOW() - $${paramIdx}::interval`;
        paramIdx++;
      }
    }

    // Cloak filter
    let cloakFilter = '';
    if (cloak) {
      params.push(cloak);
      cloakFilter = ` AND (ds.cloak_address = $${paramIdx} OR ds.cloak_slug = $${paramIdx})`;
      paramIdx++;
    }

    // Viewer cloak join + quality vote join
    let viewerJoinSelect = ', false AS is_joined_cloak';
    let viewerJoinJoin = '';
    let viewerQualitySelect = ', NULL::smallint AS my_quality_vote';
    let viewerQualityJoin = '';
    if (viewer) {
      params.push(viewer);
      viewerJoinSelect = `, COALESCE(cj.user_address IS NOT NULL, false) AS is_joined_cloak`;
      viewerJoinJoin = ` LEFT JOIN cloak_joins cj ON cj.cloak_address = ds.cloak_address AND cj.user_address = $${paramIdx}`;
      viewerQualitySelect = `, vqv.direction AS my_quality_vote`;
      viewerQualityJoin = ` LEFT JOIN duel_votes vqv ON vqv.cloak_address = ds.cloak_address AND vqv.duel_id = ds.duel_id AND vqv.voter_address = $${paramIdx}`;
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
        extraFilter = ' AND ds.total_votes >= 2';
        sortClause = `(1 - ABS((ds.agree_votes::float / NULLIF(ds.total_votes, 0) - 0.5) * 2)) DESC, ds.total_votes DESC`;
        break;
      case 'ending_soon':
        // On cloak pages, don't filter — the client splits active vs concluded.
        // On global feed, only show active duels.
        if (!cloak) extraFilter = ` AND ds.is_tallied = false`;
        sortClause = `CASE WHEN ds.end_block > ds.start_block THEN (ds.created_at + ((ds.end_block - ds.start_block) * INTERVAL '30 seconds')) ELSE ds.created_at + INTERVAL '1 year' END ASC`;
        break;
      case 'recently_concluded':
        // On cloak pages, don't filter — the client splits active vs concluded.
        // On global feed, only show tallied duels.
        if (!cloak) extraFilter = ` AND ds.is_tallied = true`;
        sortClause = `ds.updated_at DESC`;
        break;
      case 'top':
        sortClause = `ds.total_votes DESC`;
        break;
      case 'best':
      default: {
        // Blended score — each signal roughly 0-1 range, weighted evenly
        const hotScore = `(ds.total_votes + COALESCE(cc.comment_count, 0) * 2) / POWER(EXTRACT(EPOCH FROM NOW() - ds.created_at)/3600 + 2, 1.5)`;
        const controversyBonus = `CASE WHEN ds.total_votes >= 10 THEN (1 - ABS((ds.agree_votes::float / NULLIF(ds.total_votes, 0) - 0.5) * 2)) ELSE 0 END`;
        const topScore = `LN(GREATEST(ds.total_votes, 1) + 1) * 0.5`;
        const endingSoonBonus = `CASE WHEN ds.is_tallied = false AND ds.end_block > ds.start_block THEN GREATEST(0, 1.0 - EXTRACT(EPOCH FROM ((ds.created_at + ((ds.end_block - ds.start_block) * INTERVAL '30 seconds')) - NOW())) / 86400) ELSE 0 END`;
        const joinedBoost = viewer ? `CASE WHEN cj.user_address IS NOT NULL THEN 1.5 ELSE 0 END` : '0';
        const qualityScore = `(COALESCE(qv.quality_up, 0) - COALESCE(qv.quality_down, 0)) * 0.3`;
        sortClause = `(${joinedBoost} + ${hotScore} + ${controversyBonus} + ${topScore} + ${endingSoonBonus} + ${qualityScore}) DESC`;
        break;
      }
    }

    // When viewing a specific cloak, sort non-tallied duels first (active + finalizing)
    if (cloak) {
      const activeFirst = `CASE WHEN ds.is_tallied = false THEN 0 ELSE 1 END`;
      sortClause = `${activeFirst} ASC, ${sortClause}`;
    }

    // Filter to active-only duels (not tallied)
    if (activeOnly) {
      extraFilter += ` AND ds.is_tallied = false`;
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
        COALESCE(cc.comment_count, 0)::int AS comment_count,
        COALESCE(qv.quality_up, 0)::int AS quality_upvotes,
        COALESCE(qv.quality_down, 0)::int AS quality_downvotes,
        ds.created_at,
        sched.duel_interval_seconds
        ${viewerJoinSelect}
        ${viewerQualitySelect}
      FROM duel_snapshots ds
      LEFT JOIN duel_schedule sched ON sched.cloak_address = ds.cloak_address
      LEFT JOIN (
        SELECT cloak_address, duel_id, COUNT(*)::int AS comment_count
        FROM comments WHERE is_deleted = false GROUP BY cloak_address, duel_id
      ) cc ON cc.cloak_address = ds.cloak_address AND cc.duel_id = ds.duel_id
      LEFT JOIN (
        SELECT cloak_address, duel_id,
          SUM(CASE WHEN direction = 1 THEN 1 ELSE 0 END)::int AS quality_up,
          SUM(CASE WHEN direction = -1 THEN 1 ELSE 0 END)::int AS quality_down
        FROM duel_votes GROUP BY cloak_address, duel_id
      ) qv ON qv.cloak_address = ds.cloak_address AND qv.duel_id = ds.duel_id
      ${viewerJoinJoin}
      ${viewerQualityJoin}
      WHERE 1=1 ${cloakFilter} ${timeFilter} ${extraFilter}
      ORDER BY ${sortClause}
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await pool.query(query, params);

    // Use the block clock (updated by cron every 30s) for accurate endTime.
    // Anchoring to the latest known block avoids drift from variable block times.
    const clock = getBlockClock();

    const duels = result.rows.map((row) => {
      const startBlock = row.start_block || 0;
      const endBlock = row.end_block || 0;
      let endTime: string | null = null;
      const created = new Date(row.created_at);

      if (endBlock > 0 && clock.blockNumber > 0) {
        const msPerBlock = clock.avgBlockTime * 1000;
        const clockAge = Date.now() - clock.observedAt.getTime();
        if (endBlock > clock.blockNumber) {
          // Dynamic estimate: now + remaining blocks * measured block time
          const remainingBlocks = endBlock - clock.blockNumber;
          const rawEndTime = Date.now() + remainingBlocks * msPerBlock - clockAge;
          endTime = new Date(rawEndTime - VOTE_MINING_BUFFER_MS).toISOString();
        } else {
          // Block has passed endBlock — duel ended, endTime is in the past
          const pastBlocks = clock.blockNumber - endBlock;
          endTime = new Date(Date.now() - pastBlocks * msPerBlock - clockAge).toISOString();
        }
      } else if (startBlock > 0 && endBlock > startBlock) {
        // Fallback when block clock not initialized yet: creation-time estimate
        const durationSeconds = (endBlock - startBlock) * 30;
        const rawEndTime = created.getTime() + durationSeconds * 1000;
        endTime = new Date(rawEndTime - VOTE_MINING_BUFFER_MS).toISOString();
      } else if (row.duel_interval_seconds && row.duel_interval_seconds > 0) {
        // Fallback: use schedule interval when blocks haven't synced yet
        const rawEndTime = created.getTime() + row.duel_interval_seconds * 1000;
        endTime = new Date(rawEndTime - VOTE_MINING_BUFFER_MS).toISOString();
      }

      return {
        cloakAddress: row.cloak_address,
        cloakName: row.cloak_name,
        cloakSlug: row.cloak_slug,
        duelId: row.duel_id,
        statementText: row.statement_text,
        startBlock,
        endBlock,
        totalVotes: row.total_votes,
        agreeVotes: row.agree_votes,
        disagreeVotes: row.disagree_votes,
        isTallied: row.is_tallied,
        commentCount: row.comment_count,
        qualityUpvotes: row.quality_upvotes,
        qualityDownvotes: row.quality_downvotes,
        myQualityVote: row.my_quality_vote ?? null,
        isJoinedCloak: row.is_joined_cloak ?? false,
        createdAt: row.created_at,
        endTime,
      };
    });

    const nextCursor = result.rows.length === limit ? String(cursor + limit) : null;

    res.setHeader('Cache-Control', 'no-cache');
    return res.json({ duels, nextCursor });
  } catch (err: any) {
    console.error('[feed] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

export default router;
