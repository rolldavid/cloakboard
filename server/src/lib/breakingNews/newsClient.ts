/**
 * TheNewsAPI.com client — fetches headlines for breaking news duel creation.
 * Uses /v1/news/headlines for importance-ranked, category-grouped stories.
 * Falls back to /v1/news/top if headlines endpoint unavailable.
 * Docs: https://www.thenewsapi.com/documentation
 */

export interface NewsArticle {
  uuid: string;
  title: string;
  description: string;
  snippet: string;
  url: string;
  image_url: string | null;
  categories: string[];
  published_at: string;
  source: string;
}

interface TopStoriesResponse {
  meta: { found: number; returned: number; limit: number; page: number };
  data: NewsArticle[];
}

interface HeadlinesResponse {
  data: Record<string, NewsArticle[]>;
}

const BASE_URL = 'https://api.thenewsapi.com/v1/news';

/**
 * Fetch headlines from TheNewsAPI (importance-ranked, grouped by category).
 * Returns a flat array of articles across all categories.
 */
export async function fetchHeadlines(opts?: {
  locale?: string;
  language?: string;
  headlinesPerCategory?: number;
}): Promise<{ article: NewsArticle; newsCategory: string }[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn('[newsClient] NEWS_API_KEY not set, skipping news fetch');
    return [];
  }

  const params = new URLSearchParams({
    api_token: apiKey,
    language: opts?.language || 'en',
    headlines_per_category: String(opts?.headlinesPerCategory || 5),
    include_similar: 'false',
  });

  if (opts?.locale) {
    params.set('locale', opts.locale);
  }

  try {
    const res = await fetch(`${BASE_URL}/headlines?${params}`);
    if (!res.ok) {
      const text = await res.text();
      // Fall back to top stories if headlines not available on plan
      if (res.status === 403 || res.status === 402) {
        console.warn('[newsClient] Headlines endpoint not available, falling back to top stories');
        return fetchTopStoriesAllCategories(opts?.language);
      }
      console.error(`[newsClient] API error ${res.status}: ${text}`);
      return [];
    }
    const data: HeadlinesResponse = await res.json();
    const results: { article: NewsArticle; newsCategory: string }[] = [];
    for (const [category, articles] of Object.entries(data.data || {})) {
      for (const article of articles) {
        results.push({ article, newsCategory: category });
      }
    }
    return results;
  } catch (err: any) {
    console.error('[newsClient] Headlines fetch failed:', err?.message);
    return [];
  }
}

/**
 * Fallback: fetch top stories from all categories individually.
 */
async function fetchTopStoriesAllCategories(language?: string): Promise<{ article: NewsArticle; newsCategory: string }[]> {
  const categories = ['politics', 'tech', 'business', 'science', 'entertainment', 'general', 'health', 'sports'];
  const results: { article: NewsArticle; newsCategory: string }[] = [];

  const fetches = categories.map(async (cat) => {
    try {
      const articles = await fetchTopStories({ categories: cat, limit: 3, language });
      return articles.map((a) => ({ article: a, newsCategory: cat }));
    } catch {
      return [];
    }
  });

  const batches = await Promise.all(fetches);
  for (const batch of batches) results.push(...batch);
  return results;
}

/**
 * Fetch top stories from TheNewsAPI (legacy endpoint, used as fallback).
 */
export async function fetchTopStories(opts?: {
  categories?: string;
  limit?: number;
  language?: string;
}): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_token: apiKey,
    language: opts?.language || 'en',
    limit: String(opts?.limit || 3),
  });

  if (opts?.categories) {
    params.set('categories', opts.categories);
  }

  try {
    const res = await fetch(`${BASE_URL}/top?${params}`);
    if (!res.ok) {
      console.error(`[newsClient] API error ${res.status}: ${await res.text()}`);
      return [];
    }
    const data: TopStoriesResponse = await res.json();
    return data.data || [];
  } catch (err: any) {
    console.error('[newsClient] Fetch failed:', err?.message);
    return [];
  }
}
