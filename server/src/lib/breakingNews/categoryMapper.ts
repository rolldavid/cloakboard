/**
 * Maps TheNewsAPI categories to DuelCloak subcategory slugs.
 *
 * TheNewsAPI categories: general, science, sports, business, health, entertainment, tech, politics, travel, food
 * DuelCloak categories: politics, geopolitics, tech-ai, culture, world, economy, climate-science, elections
 */

import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/pool.js';

// Static mapping: newsapi category -> { categorySlug, subcategorySlug }
const CATEGORY_MAP: Record<string, { categorySlug: string; subcategorySlug: string }> = {
  politics:      { categorySlug: 'politics',        subcategorySlug: 'issues' },
  tech:          { categorySlug: 'tech-ai',          subcategorySlug: 'big-tech' },
  science:       { categorySlug: 'climate-science',  subcategorySlug: 'space' },
  business:      { categorySlug: 'economy',          subcategorySlug: 'trade-war' },
  health:        { categorySlug: 'climate-science',  subcategorySlug: 'solutions' },
  entertainment: { categorySlug: 'culture',          subcategorySlug: 'celebrities' },
  sports:        { categorySlug: 'culture',          subcategorySlug: 'quality-of-life' },
  general:       { categorySlug: 'world',            subcategorySlug: 'global-elections' },
  travel:        { categorySlug: 'culture',          subcategorySlug: 'quality-of-life' },
  food:          { categorySlug: 'culture',          subcategorySlug: 'quality-of-life' },
};

// Keyword-based routing for more specific subcategory matching
const KEYWORD_ROUTES: { pattern: RegExp; categorySlug: string; subcategorySlug: string }[] = [
  { pattern: /\bAI\b|artificial intelligence|ChatGPT|OpenAI|machine learning/i, categorySlug: 'tech-ai', subcategorySlug: 'ai' },
  { pattern: /\bTrump\b/i,                    categorySlug: 'politics',        subcategorySlug: 'trump' },
  { pattern: /\bCongress\b|Senate|House.*Rep/i, categorySlug: 'politics',      subcategorySlug: 'congress' },
  { pattern: /\bUkraine\b|Zelensky|Kyiv/i,    categorySlug: 'geopolitics',     subcategorySlug: 'ukraine' },
  { pattern: /\bGaza\b|Hamas|Palestinian/i,    categorySlug: 'geopolitics',     subcategorySlug: 'gaza' },
  { pattern: /\bIsrael\b|Netanyahu/i,          categorySlug: 'geopolitics',     subcategorySlug: 'israel' },
  { pattern: /\bIran\b|Tehran/i,              categorySlug: 'geopolitics',     subcategorySlug: 'iran' },
  { pattern: /\bChina\b|Beijing|Xi Jinping/i, categorySlug: 'geopolitics',     subcategorySlug: 'china' },
  { pattern: /\bclimate\b|global warming|carbon/i, categorySlug: 'climate-science', subcategorySlug: 'climate-change-causes' },
  { pattern: /\bspace\b|NASA|SpaceX|rocket|orbit/i, categorySlug: 'climate-science', subcategorySlug: 'space' },
  { pattern: /\belection\b|vote|ballot|campaign/i, categorySlug: 'elections',  subcategorySlug: 'us-president' },
  { pattern: /\btariff\b|trade war|import.*tax/i, categorySlug: 'economy',    subcategorySlug: 'trade-war' },
  { pattern: /\binflation\b|CPI|interest rate|Fed\b/i, categorySlug: 'economy', subcategorySlug: 'inflation' },
  { pattern: /\bhousing\b|rent|mortgage/i,    categorySlug: 'economy',         subcategorySlug: 'housing' },
  { pattern: /\bimmigration\b|border|migrant/i, categorySlug: 'politics',     subcategorySlug: 'immigration' },
  { pattern: /\bstartup\b|venture|funding round/i, categorySlug: 'tech-ai',   subcategorySlug: 'startups' },
  { pattern: /\bApple\b|Google\b|Meta\b|Amazon\b|Microsoft\b/i, categorySlug: 'tech-ai', subcategorySlug: 'big-tech' },
  { pattern: /\bMiddle East\b|Syria|Lebanon/i, categorySlug: 'geopolitics',   subcategorySlug: 'middle-east' },
  { pattern: /\bVenezuela\b|Maduro/i,         categorySlug: 'geopolitics',     subcategorySlug: 'venezuela' },
  { pattern: /\boil\b|OPEC|petroleum/i,       categorySlug: 'geopolitics',     subcategorySlug: 'oil' },
  { pattern: /\bweather\b|hurricane|tornado|flood/i, categorySlug: 'climate-science', subcategorySlug: 'weather' },
  { pattern: /\bearthquake\b|wildfire|disaster/i, categorySlug: 'climate-science', subcategorySlug: 'natural-disasters' },
];

// Cache: subcategory slug -> id
let subcategoryCache: Map<string, number> | null = null;

async function loadSubcategoryCache(): Promise<Map<string, number>> {
  if (subcategoryCache) return subcategoryCache;
  const result = await pool.query(
    `SELECT s.id, s.slug, c.slug AS category_slug
     FROM subcategories s
     JOIN categories c ON c.id = s.category_id`,
  );
  subcategoryCache = new Map();
  for (const row of result.rows) {
    subcategoryCache.set(`${row.category_slug}/${row.slug}`, row.id);
  }
  return subcategoryCache;
}

/** Clear subcategory cache (call if subcategories change). */
export function clearSubcategoryCache(): void {
  subcategoryCache = null;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

/**
 * Use Claude Haiku to suggest a 1-2 word thematic subcategory name for a headline.
 */
async function suggestSubcategoryName(title: string, description: string, parentCategorySlug: string): Promise<string | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      system: `You suggest short subcategory names for a news voting platform. Given a headline, suggest a 1-2 word thematic subcategory name. The parent category is "${parentCategorySlug}". The name should be broad enough to apply to multiple future stories on this topic, not just this one headline. Examples: "crypto", "space", "immigration", "ai", "trade-war", "elections", "climate". Respond with ONLY the subcategory name in lowercase, hyphenated if 2 words. Nothing else.`,
      messages: [
        { role: 'user', content: `Headline: "${title}"\nSummary: "${description}"` },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim().toLowerCase() : '';
    if (!text || text.length > 30 || text.includes('\n')) return null;
    return text.replace(/[^a-z0-9-\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 30);
  } catch (err: any) {
    console.warn('[categoryMapper] Haiku subcategory suggestion failed:', err?.message);
    return null;
  }
}

/**
 * Create a new subcategory in the DB and return its ID.
 */
async function createSubcategory(categorySlug: string, subcategoryName: string): Promise<number | null> {
  const slug = subcategoryName.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 30);
  if (!slug) return null;

  // Get category ID
  const catResult = await pool.query(`SELECT id FROM categories WHERE slug = $1`, [categorySlug]);
  if (catResult.rows.length === 0) return null;
  const categoryId = catResult.rows[0].id;

  // Display name: capitalize words
  const displayName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  try {
    const result = await pool.query(
      `INSERT INTO subcategories (category_id, name, slug, created_by)
       VALUES ($1, $2, $3, 'breaking-news-agent')
       ON CONFLICT (category_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [categoryId, displayName, slug],
    );
    clearSubcategoryCache();
    console.log(`[categoryMapper] Created subcategory "${displayName}" (${categorySlug}/${slug})`);
    return result.rows[0].id;
  } catch (err: any) {
    console.warn('[categoryMapper] Failed to create subcategory:', err?.message);
    return null;
  }
}

/**
 * Map a news article to a DuelCloak subcategory ID.
 * Uses keyword matching first, then static mapping, then auto-creates via Haiku.
 */
export async function mapToSubcategory(
  newsCategory: string,
  title: string,
  description: string,
): Promise<number | null> {
  const cache = await loadSubcategoryCache();
  const text = `${title} ${description}`;

  // Try keyword-based routing first (more specific)
  for (const route of KEYWORD_ROUTES) {
    if (route.pattern.test(text)) {
      const key = `${route.categorySlug}/${route.subcategorySlug}`;
      const id = cache.get(key);
      if (id) return id;
    }
  }

  // Fall back to static category mapping
  const mapping = CATEGORY_MAP[newsCategory] || CATEGORY_MAP['general'];
  const key = `${mapping.categorySlug}/${mapping.subcategorySlug}`;
  const id = cache.get(key);
  if (id) return id;

  // Auto-create: ask Haiku for a subcategory name and create it
  const suggested = await suggestSubcategoryName(title, description, mapping.categorySlug);
  if (suggested) {
    // Check if it already exists after cache clear
    const freshCache = await loadSubcategoryCache();
    const suggestedKey = `${mapping.categorySlug}/${suggested}`;
    const existingId = freshCache.get(suggestedKey);
    if (existingId) return existingId;

    const newId = await createSubcategory(mapping.categorySlug, suggested);
    if (newId) return newId;
  }

  // Absolute fallback: any subcategory
  const first = cache.values().next();
  return first.done ? null : first.value;
}
