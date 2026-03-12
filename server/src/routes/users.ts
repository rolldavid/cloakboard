/**
 * GET /api/users/:username — User profile data (comments)
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';

const router = Router();

router.get('/:username', async (req: Request, res: Response) => {
  const username = req.params.username;

  try {
    // Optional address param — allows own-profile staking lookups even without comments
    const addressParam = typeof req.query.address === 'string' ? req.query.address : null;

    // Get user address from comments (case-insensitive)
    const userLookup = await pool.query(
      `SELECT DISTINCT author_address, author_name FROM comments
       WHERE LOWER(author_name) = LOWER($1) LIMIT 1`,
      [username],
    );

    const userAddress = userLookup.rows[0]?.author_address ?? addressParam;
    const authorName = userLookup.rows[0]?.author_name ?? username;

    // Fetch comments + staking + active stake details in parallel
    const [commentsResult, stakingResult, activeStakesResult] = await Promise.all([
      userAddress && userLookup.rowCount! > 0
        ? pool.query(
            `SELECT
               c.id, c.body, (c.upvotes - c.downvotes) AS score, c.created_at, c.duel_id,
               d.slug AS duel_slug, s.name AS subcategory_name
             FROM comments c
             LEFT JOIN duels d ON d.id = c.duel_id
             LEFT JOIN subcategories s ON s.id = d.subcategory_id
             WHERE c.author_address = $1 AND c.is_deleted = false
             ORDER BY c.created_at DESC
             LIMIT 50`,
            [userAddress],
          )
        : Promise.resolve({ rows: [] }),
      userAddress
        ? pool.query(
            `SELECT
               COALESCE(SUM(staked_amount) FILTER (WHERE stake_status = 'locked'), 0)::int AS total_staked,
               COALESCE(SUM(stake_reward) FILTER (WHERE stake_status = 'rewarded'), 0)::int AS total_rewarded,
               COALESCE(SUM(staked_amount) FILTER (WHERE stake_status = 'burned'), 0)::int AS total_burned,
               COUNT(*) FILTER (WHERE stake_status = 'locked')::int AS active_stakes
             FROM duels
             WHERE staker_address = $1`,
            [userAddress],
          )
        : Promise.resolve({ rows: [{ total_staked: 0, total_rewarded: 0, total_burned: 0, active_stakes: 0 }] }),
      userAddress
        ? pool.query(
            `SELECT id, title, slug, staked_amount, end_block, total_votes, stake_multiplier
             FROM duels
             WHERE staker_address = $1 AND stake_status = 'locked'
             ORDER BY created_at DESC`,
            [userAddress],
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const staking = stakingResult.rows[0];

    return res.json({
      username: authorName,
      address: userAddress,
      staking: {
        totalStaked: staking.total_staked,
        totalRewarded: staking.total_rewarded,
        totalBurned: staking.total_burned,
        activeStakes: staking.active_stakes,
        activeStakesList: activeStakesResult.rows.map((row: any) => ({
          duelId: row.id,
          title: row.title,
          slug: row.slug,
          amount: row.staked_amount,
          endBlock: row.end_block ?? null,
          totalVotes: row.total_votes ?? 0,
          multiplier: row.stake_multiplier ?? 1,
        })),
      },
      comments: commentsResult.rows.map((row: any) => ({
        id: row.id,
        body: row.body,
        score: row.score,
        duelId: row.duel_id,
        duelSlug: row.duel_slug || String(row.duel_id),
        subcategoryName: row.subcategory_name || null,
        createdAt: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[users] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

export default router;
