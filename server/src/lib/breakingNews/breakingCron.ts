/**
 * Breaking news cron — fetches top stories and creates 24-hour binary duels.
 *
 * Target: ~10-15 duels/day across categories, published in real-time as news breaks.
 * Runs every 15 minutes, respects minimum gap and daily quota.
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { fetchHeadlines, type NewsArticle } from './newsClient.js';
import { mapToSubcategory } from './categoryMapper.js';
import { getBlockClock, refreshBlockClock } from '../blockClock.js';
import { evaluateHeadline } from './headlineFilter.js';

const DURATION_SECONDS = 86400; // 24 hours
const MAX_DUELS_PER_DAY = 15;
const MIN_GAP_MS = 20 * 60 * 1000; // 20 minutes between publishes
const TITLE_MAX_LENGTH = 200;

function titleHash(title: string): string {
  return crypto.createHash('sha256').update(title.toLowerCase().trim()).digest('hex').slice(0, 32);
}

/**
 * Simplify a news headline into a duel-worthy statement.
 * Removes source attribution, trims length, ensures it reads as a factual event.
 */
function simplifyTitle(article: NewsArticle): string {
  let title = article.title;

  // Remove common suffixes like "- CNN", "| Reuters", "— BBC"
  title = title.replace(/\s*[-–—|]\s*[A-Z][A-Za-z\s.]+$/, '').trim();

  // Remove leading "Breaking:" or "BREAKING:" prefix (we add our own label)
  title = title.replace(/^(BREAKING|Breaking|EXCLUSIVE|Exclusive):?\s*/i, '').trim();

  // Truncate if too long
  if (title.length > TITLE_MAX_LENGTH) {
    title = title.slice(0, TITLE_MAX_LENGTH - 3) + '...';
  }

  return title;
}

/**
 * Generate a short summary from the article description/snippet.
 */
function generateDescription(article: NewsArticle): string {
  const desc = article.description || article.snippet || '';
  if (desc.length > 500) return desc.slice(0, 497) + '...';
  return desc;
}

/**
 * Check how many breaking duels were published today.
 */
async function getDailyCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM breaking_news_log
     WHERE created_at >= NOW() - INTERVAL '24 hours'`,
  );
  return result.rows[0].count;
}

/**
 * Check when the last breaking duel was published.
 */
async function getLastPublishTime(): Promise<Date | null> {
  const result = await pool.query(
    `SELECT created_at FROM breaking_news_log ORDER BY created_at DESC LIMIT 1`,
  );
  return result.rows.length > 0 ? new Date(result.rows[0].created_at) : null;
}

/**
 * Check if an article (by URL or title similarity) has already been published.
 */
async function isAlreadyPublished(article: NewsArticle): Promise<boolean> {
  const hash = titleHash(article.title);
  const result = await pool.query(
    `SELECT 1 FROM breaking_news_log WHERE source_url = $1 OR title_hash = $2 LIMIT 1`,
    [article.url, hash],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Generate a unique slug for a duel title.
 */
async function generateSlug(title: string): Promise<string> {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');

  // Check for uniqueness
  const existing = await pool.query(
    `SELECT 1 FROM duels WHERE slug = $1`,
    [base],
  );
  if ((existing.rowCount ?? 0) === 0) return base;

  // Append random suffix
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

/**
 * Create a breaking news duel in the database.
 */
async function createBreakingDuel(article: NewsArticle, subcategoryId: number): Promise<number | null> {
  const title = simplifyTitle(article);
  const description = generateDescription(article);
  const slug = await generateSlug(title);

  // Compute end_block
  let endBlock: number | null = null;
  try {
    let clock = getBlockClock();
    if (clock.blockNumber === 0) {
      try {
        const { getNode } = await import('../keeper/wallet.js');
        const node = await getNode();
        await refreshBlockClock(node);
        clock = getBlockClock();
      } catch { /* node not ready */ }
    }
    if (clock.blockNumber > 0) {
      const avgBlockTime = clock.avgBlockTime || 30;
      endBlock = clock.blockNumber + Math.ceil(DURATION_SECONDS / avgBlockTime);
    }
  } catch { /* will be set by cron */ }

  const endsAt = new Date(Date.now() + DURATION_SECONDS * 1000).toISOString();

  const result = await pool.query(`
    INSERT INTO duels (
      title, description, duel_type, timing_type, subcategory_id,
      ends_at, duration_seconds, end_block, slug, status,
      is_breaking, breaking_source_url, created_by
    ) VALUES ($1, $2, 'binary', 'duration', $3, $4, $5, $6, $7, 'active', true, $8, 'breaking-news-agent')
    RETURNING id
  `, [title, description, subcategoryId, endsAt, DURATION_SECONDS, endBlock, slug, article.url]);

  const duelId = result.rows[0].id;

  // Initial snapshot
  await pool.query(
    `INSERT INTO vote_snapshots (duel_id, agree_count, disagree_count, total_votes) VALUES ($1, 0, 0, 0)`,
    [duelId],
  );

  // Log to prevent duplicates
  await pool.query(
    `INSERT INTO breaking_news_log (source_url, title_hash, duel_id, news_category, published_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [article.url, titleHash(article.title), duelId, article.categories?.[0] || 'general', article.published_at || new Date().toISOString()],
  );

  // Fire-and-forget on-chain creation
  (async () => {
    try {
      const { createDuelOnChain } = await import('../keeper/createDuelOnChain.js');
      let block = endBlock;
      if (!block) {
        const { getNode } = await import('../keeper/wallet.js');
        const node = await getNode();
        const currentBlock = await node.getBlockNumber();
        const clock = getBlockClock();
        block = currentBlock + Math.ceil(DURATION_SECONDS / (clock.avgBlockTime || 30));
      }
      const onChainId = await createDuelOnChain(title, block);
      await pool.query(
        `UPDATE duels SET on_chain_id = $1, end_block = COALESCE(end_block, $2) WHERE id = $3`,
        [onChainId, block, duelId],
      );
      console.log(`[breakingCron] On-chain duel created: dbId=${duelId} onChainId=${onChainId}`);
    } catch (err: any) {
      console.error(`[breakingCron] On-chain creation failed for duelId=${duelId}:`, err?.message);
    }
  })();

  return duelId;
}

/**
 * Main cron function — fetch news and create breaking duels.
 * Call this every 15 minutes from the server's setInterval.
 */
export async function runBreakingNewsCron(): Promise<number> {
  if (!process.env.NEWS_API_KEY) return 0;

  try {
    // Check daily quota
    const dailyCount = await getDailyCount();
    if (dailyCount >= MAX_DUELS_PER_DAY) return 0;

    // Check minimum gap since last publish
    const lastPublish = await getLastPublishTime();
    if (lastPublish && Date.now() - lastPublish.getTime() < MIN_GAP_MS) return 0;

    // How many we can still publish today
    const remaining = MAX_DUELS_PER_DAY - dailyCount;

    // Fetch headlines — importance-ranked, grouped by category
    // Falls back to top stories per category if headlines endpoint unavailable
    const allArticles = await fetchHeadlines({ headlinesPerCategory: 5 });

    let published = 0;

    for (const { article, newsCategory } of allArticles) {
      if (published >= Math.min(2, remaining)) break;

      // Skip if already published
      if (await isAlreadyPublished(article)) continue;

      // Skip articles with very short titles (likely garbage)
      if (article.title.trim().length < 15) continue;

      // Filter: only accept factual event headlines (not speculation/claims/opinions)
      const accepted = await evaluateHeadline(article.title, article.description || article.snippet || '');
      if (!accepted) {
        console.log(`[breakingCron] Rejected (not factual): ${article.title}`);
        continue;
      }

      // Map to subcategory
      const subcategoryId = await mapToSubcategory(
        newsCategory,
        article.title,
        article.description || article.snippet || '',
      );
      if (!subcategoryId) {
        console.warn(`[breakingCron] No subcategory match for: ${article.title}`);
        continue;
      }

      const duelId = await createBreakingDuel(article, subcategoryId);
      if (duelId) {
        published++;
        console.log(`[breakingCron] Published breaking duel #${duelId}: ${simplifyTitle(article)}`);
      }
    }

    return published;
  } catch (err: any) {
    console.error('[breakingCron] Error:', err?.message);
    return 0;
  }
}
