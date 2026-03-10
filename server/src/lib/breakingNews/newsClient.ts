/**
 * TheNewsAPI.com client — fetches headlines for breaking news duel creation.
 * Uses /v1/news/headlines for importance-ranked, category-grouped stories.
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
      console.error(`[newsClient] API error ${res.status}: ${await res.text()}`);
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
