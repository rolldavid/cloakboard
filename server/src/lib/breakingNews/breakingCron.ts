/**
 * Breaking news cron — fetches top headlines, uses Sonnet to pick and reframe
 * into agree/disagree statements, creates 24-hour binary duels.
 *
 * Flow: fetch #1 headline per category → filter already-published → send
 * candidates to Sonnet in a single call → Sonnet picks top 2 and reframes →
 * create duels with reframed statement as title, original headline stored.
 *
 * Runs every 15 minutes, up to 2 duels per run, 100/day max.
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { fetchHeadlines, type NewsArticle } from './newsClient.js';
import { getBlockClock, refreshBlockClock } from '../blockClock.js';
import { pickAndReframe } from './headlineReframer.js';

const DURATION_SECONDS = 86400; // 24 hours
const MAX_DUELS_PER_DAY = 100;
const MIN_GAP_MS = 15 * 60 * 1000; // 15 minutes between publishes

function titleHash(title: string): string {
  return crypto.createHash('sha256').update(title.toLowerCase().trim()).digest('hex').slice(0, 32);
}

/**
 * Clean a headline — remove source suffixes and prefixes.
 */
function cleanHeadline(title: string): string {
  let t = title;
  t = t.replace(/\s*[-–—|]\s*[A-Z][A-Za-z\s.]+$/, '').trim();
  t = t.replace(/^(BREAKING|Breaking|EXCLUSIVE|Exclusive):?\s*/i, '').trim();
  if (t.length > 300) t = t.slice(0, 297) + '...';
  return t;
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

  const existing = await pool.query(`SELECT 1 FROM duels WHERE slug = $1`, [base]);
  if ((existing.rowCount ?? 0) === 0) return base;

  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

/**
 * Create a breaking news duel in the database.
 * @param statement - Sonnet-reframed agree/disagree statement (duel title)
 * @param headline - Original cleaned headline (shown as context)
 * @param article - Source article for URL, description, dedup
 * @param subcategoryId - Mapped subcategory
 */
async function createBreakingDuel(
  statement: string,
  headline: string,
  article: NewsArticle,
  subcategoryId: number,
): Promise<number | null> {
  const description = article.description || article.snippet || '';
  const slug = await generateSlug(statement);

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
      is_breaking, breaking_source_url, breaking_headline, created_by
    ) VALUES ($1, $2, 'binary', 'duration', $3, $4, $5, $6, $7, 'active', true, $8, $9, 'breaking-news-agent')
    RETURNING id
  `, [statement, description, subcategoryId, endsAt, DURATION_SECONDS, endBlock, slug, article.url, headline]);

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
      const onChainId = await createDuelOnChain(statement, block);
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
 * Resolve Sonnet's category/subcategory slugs to a DB subcategory ID.
 * If the subcategory doesn't exist, auto-creates it under the given category.
 */
async function resolveSubcategory(categorySlug: string, subcategorySlug: string): Promise<number | null> {
  // Try exact match first
  const exact = await pool.query(
    `SELECT s.id FROM subcategories s
     JOIN categories c ON c.id = s.category_id
     WHERE c.slug = $1 AND s.slug = $2`,
    [categorySlug, subcategorySlug],
  );
  if (exact.rows.length > 0) return exact.rows[0].id;

  // Category exists? If not, fall back to first available subcategory
  const cat = await pool.query(`SELECT id FROM categories WHERE slug = $1`, [categorySlug]);
  if (cat.rows.length === 0) {
    console.warn(`[breakingCron] Unknown category slug: ${categorySlug}, using fallback`);
    const fallback = await pool.query(`SELECT id FROM subcategories LIMIT 1`);
    return fallback.rows.length > 0 ? fallback.rows[0].id : null;
  }
  const categoryId = cat.rows[0].id;

  // Auto-create the subcategory
  const displayName = subcategorySlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  try {
    const created = await pool.query(
      `INSERT INTO subcategories (category_id, name, slug, created_by)
       VALUES ($1, $2, $3, 'breaking-news-agent')
       ON CONFLICT (category_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [categoryId, displayName, subcategorySlug],
    );
    console.log(`[breakingCron] Auto-created subcategory "${displayName}" (${categorySlug}/${subcategorySlug})`);
    return created.rows[0].id;
  } catch (err: any) {
    console.warn(`[breakingCron] Failed to create subcategory:`, err?.message);
    // Fall back to first subcategory in this category
    const fallback = await pool.query(
      `SELECT id FROM subcategories WHERE category_id = $1 LIMIT 1`,
      [categoryId],
    );
    return fallback.rows.length > 0 ? fallback.rows[0].id : null;
  }
}

/**
 * Main cron function — fetch news, pick + reframe via Sonnet, create duels.
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

    const remaining = MAX_DUELS_PER_DAY - dailyCount;

    // Fetch headlines — take #1 from each category for cross-category ranking
    const allArticles = await fetchHeadlines({ headlinesPerCategory: 3 });

    // Group by category, take top unprocessed from each
    const categoryBest = new Map<string, { article: NewsArticle; newsCategory: string }>();
    for (const entry of allArticles) {
      if (categoryBest.has(entry.newsCategory)) continue;
      if (entry.article.title.trim().length < 15) continue;
      if (await isAlreadyPublished(entry.article)) continue;
      categoryBest.set(entry.newsCategory, entry);
    }

    const candidates = Array.from(categoryBest.values());
    if (candidates.length === 0) return 0;

    // Send all candidates to Sonnet for ranking + reframing
    const sonnetInput = candidates.map(({ article }) => ({
      title: cleanHeadline(article.title),
      description: article.description || article.snippet || '',
      source: article.source,
    }));

    const picks = await pickAndReframe(sonnetInput);
    if (picks.length === 0) {
      console.log('[breakingCron] Sonnet found no duel-worthy headlines this cycle');
      return 0;
    }

    let published = 0;

    for (const pick of picks) {
      if (published >= Math.min(2, remaining)) break;

      const { article } = candidates[pick.index];
      const headline = cleanHeadline(article.title);

      // Resolve Sonnet's category/subcategory to a DB subcategory ID
      const subcategoryId = await resolveSubcategory(pick.category, pick.subcategory);
      if (!subcategoryId) {
        console.warn(`[breakingCron] Could not resolve category ${pick.category}/${pick.subcategory} for: ${headline}`);
        continue;
      }

      const duelId = await createBreakingDuel(pick.statement, headline, article, subcategoryId);
      if (duelId) {
        published++;
        console.log(`[breakingCron] Published #${duelId}: "${pick.statement}" → ${pick.category}/${pick.subcategory} (from: ${headline})`);
      }
    }

    return published;
  } catch (err: any) {
    console.error('[breakingCron] Error:', err?.message);
    return 0;
  }
}
