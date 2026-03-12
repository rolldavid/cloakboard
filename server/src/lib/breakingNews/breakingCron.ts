/**
 * Breaking news cron — fetches top headlines, uses Sonnet to pick and reframe
 * into agree/disagree statements, creates 24-hour binary duels.
 *
 * Flow: fetch headlines → filter already-published → boost source diversity →
 * send candidates to Sonnet in a single call → Sonnet picks and reframes →
 * create duels with reframed statement as title, original headline stored.
 *
 * Runs every 15 minutes, targets exactly 2 duels per hour.
 */

import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { fetchHeadlines, type NewsArticle } from './newsClient.js';
import { pickAndReframe } from './headlineReframer.js';
import { processBreakingImage } from './imageProcessor.js';

const DURATION_SECONDS = 86400; // 24 hours
const MAX_DUELS_PER_DAY = 100;
const TARGET_PER_HOUR = 2;

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
 * Count how many breaking duels were published in the last hour.
 */
async function getHourlyCount(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM breaking_news_log
     WHERE created_at >= NOW() - INTERVAL '1 hour'`,
  );
  return result.rows[0].count;
}

/**
 * Get source domains used in recent breaking duels (last 48 hours) with counts.
 * Used to deprioritize over-represented sources and boost underrepresented ones.
 */
async function getRecentSourceCounts(): Promise<Map<string, number>> {
  const result = await pool.query(`
    SELECT source_domain, COUNT(*)::int AS cnt
    FROM breaking_news_log
    WHERE created_at >= NOW() - INTERVAL '48 hours'
      AND source_domain IS NOT NULL
    GROUP BY source_domain
  `);
  const counts = new Map<string, number>();
  for (const row of result.rows) {
    counts.set(row.source_domain, row.cnt);
  }
  return counts;
}

/**
 * Extract domain from a source name (e.g. "BBC News" → "bbc", "The Guardian" → "theguardian").
 */
function sourceToDomain(source: string): string {
  return source.toLowerCase().replace(/^the\s+/i, '').replace(/[^a-z0-9]/g, '');
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
  sourceDomain?: string,
  processedImageUrl?: string | null,
): Promise<number | null> {
  const description = article.description || article.snippet || '';
  const slug = await generateSlug(statement);
  const endsAt = new Date(Date.now() + DURATION_SECONDS * 1000).toISOString();

  // Compute end_block for on-chain creation
  let endBlock: number | null = null;
  try {
    const { getBlockClock, refreshBlockClock } = await import('../blockClock.js');
    const { getNode } = await import('../keeper/wallet.js');
    let clock = getBlockClock();
    if (clock.blockNumber === 0) {
      const node = await getNode();
      await refreshBlockClock(node);
      clock = getBlockClock();
    }
    const avgBlockTime = clock.avgBlockTime || 30;
    endBlock = clock.blockNumber + Math.ceil(DURATION_SECONDS / avgBlockTime);
  } catch (err: any) {
    console.warn('[breakingCron] Block clock unavailable for end_block:', err?.message);
  }

  // Breaking duels skip staking — go live immediately
  const result = await pool.query(`
    INSERT INTO duels (
      title, description, duel_type, timing_type, subcategory_id,
      ends_at, duration_seconds, end_block, slug, status,
      is_breaking, breaking_source_url, breaking_headline, breaking_image_url, created_by,
      queue_status
    ) VALUES ($1, $2, 'binary', 'duration', $3, $4, $5, $6, $7, 'active', true, $8, $9, $10, 'breaking-news-agent',
      'live'
    )
    RETURNING id
  `, [statement, description, subcategoryId, endsAt, DURATION_SECONDS, endBlock, slug, article.url, headline, processedImageUrl || null]);

  const duelId = result.rows[0].id;

  // Fire-and-forget on-chain creation
  import('../keeper/createDuelOnChain.js').then(async ({ createDuelOnChain }) => {
    try {
      const onChainId = await createDuelOnChain(statement, endBlock || 4294967295);
      await pool.query(`UPDATE duels SET on_chain_id = $1 WHERE id = $2`, [onChainId, duelId]);
      console.log(`[breakingCron] On-chain duel created for #${duelId} (onChainId=${onChainId})`);
    } catch (err: any) {
      console.error(`[breakingCron] On-chain creation failed for duel #${duelId} (will retry via cron):`, err?.message);
    }
  });

  // Log to prevent duplicates + track source for diversity
  await pool.query(
    `INSERT INTO breaking_news_log (source_url, title_hash, duel_id, news_category, published_at, source_domain)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [article.url, titleHash(article.title), duelId, article.categories?.[0] || 'general', article.published_at || new Date().toISOString(), sourceDomain || null],
  );

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
 *
 * Targets exactly 2 duels per hour:
 * - Each 15-min run publishes 0-2 depending on hourly quota remaining
 * - If nothing important enough, holds off until next run
 * - Source diversity: sends multiple candidates per category, boosts underrepresented sources
 */
export async function runBreakingNewsCron(): Promise<number> {
  if (!process.env.NEWS_API_KEY) return 0;

  try {
    // Check daily quota
    const dailyCount = await getDailyCount();
    if (dailyCount >= MAX_DUELS_PER_DAY) return 0;

    // Check hourly pacing — target exactly 2 per hour
    const hourlyCount = await getHourlyCount();
    const hourlySlots = TARGET_PER_HOUR - hourlyCount;
    if (hourlySlots <= 0) return 0;

    const remaining = Math.min(hourlySlots, MAX_DUELS_PER_DAY - dailyCount);

    // Fetch headlines — request 5 per category for more source variety
    const allArticles = await fetchHeadlines({ headlinesPerCategory: 5 });

    // Get recently-used source domains for diversity scoring
    const recentSources = await getRecentSourceCounts();

    // Build candidate pool: multiple articles per category, deduped
    const candidates: { article: NewsArticle; newsCategory: string; diversityScore: number }[] = [];
    const seenSources = new Set<string>(); // Within this batch, prefer different sources

    for (const entry of allArticles) {
      if (entry.article.title.trim().length < 15) continue;
      if (await isAlreadyPublished(entry.article)) continue;

      const domain = sourceToDomain(entry.article.source);
      const recentUseCount = recentSources.get(domain) || 0;

      // Diversity score: lower recent usage = higher score
      // Also boost if this source hasn't appeared yet in this batch
      let diversityScore = 1.0;
      if (recentUseCount === 0) diversityScore = 3.0;       // Fresh source — strong boost
      else if (recentUseCount === 1) diversityScore = 2.0;   // Lightly used
      else if (recentUseCount <= 3) diversityScore = 1.0;    // Normal
      else diversityScore = 0.3;                              // Overused — penalize

      if (!seenSources.has(domain)) {
        diversityScore *= 1.5; // First appearance in this batch — bonus
        seenSources.add(domain);
      }

      candidates.push({ ...entry, diversityScore });
    }

    if (candidates.length === 0) return 0;

    // Sort by diversity score (high first), then take top candidates
    // This ensures Sonnet sees a diverse set of sources
    candidates.sort((a, b) => b.diversityScore - a.diversityScore);

    // Send up to 15 diverse candidates to Sonnet (more than before for variety)
    const topCandidates = candidates.slice(0, 15);

    const sonnetInput = topCandidates.map(({ article, diversityScore }) => ({
      title: cleanHeadline(article.title),
      description: article.description || article.snippet || '',
      source: article.source,
      diversityBonus: diversityScore >= 2.0,
    }));

    const picks = await pickAndReframe(sonnetInput);
    if (picks.length === 0) {
      console.log('[breakingCron] Sonnet found no duel-worthy headlines this cycle');
      return 0;
    }

    let published = 0;

    for (const pick of picks) {
      if (published >= remaining) break;

      const { article } = topCandidates[pick.index];
      const headline = cleanHeadline(article.title);
      const domain = sourceToDomain(article.source);

      // Resolve Sonnet's category/subcategory to a DB subcategory ID
      const subcategoryId = await resolveSubcategory(pick.category, pick.subcategory);
      if (!subcategoryId) {
        console.warn(`[breakingCron] Could not resolve category ${pick.category}/${pick.subcategory} for: ${headline}`);
        continue;
      }

      // Process image: face-crop + upload to S3 (non-blocking fallback to null)
      const imageUrl = article.image_url
        ? await processBreakingImage(article.image_url)
        : null;

      const duelId = await createBreakingDuel(pick.statement, headline, article, subcategoryId, domain, imageUrl);
      if (duelId) {
        published++;
        console.log(`[breakingCron] Published #${duelId}: "${pick.statement}" → ${pick.category}/${pick.subcategory} (source: ${article.source}, from: ${headline})`);
      }
    }

    return published;
  } catch (err: any) {
    console.error('[breakingCron] Error:', err?.message);
    return 0;
  }
}
