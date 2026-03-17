/**
 * Statement evaluation endpoint — uses Claude Sonnet to assess user-submitted
 * duel statements for quality, grammar, and predictability before creation.
 *
 * POST /api/evaluate-statement  { statement: string }
 */

import { Router, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../lib/db/pool.js';
import { checkProfanity } from '../lib/profanityFilter.js';

const router = Router();

/* ------------------------------------------------------------------ */
/*  Anthropic client (lazy singleton)                                 */
/* ------------------------------------------------------------------ */

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

/* ------------------------------------------------------------------ */
/*  Category list from DB (same pattern as headlineReframer)          */
/* ------------------------------------------------------------------ */

async function getCategoryList(): Promise<string> {
  const result = await pool.query(`
    SELECT c.slug AS cat_slug, c.name AS cat_name, s.slug AS sub_slug, s.name AS sub_name
    FROM categories c
    JOIN subcategories s ON s.category_id = c.id
    ORDER BY c.slug, s.slug
  `);

  const grouped = new Map<string, { catName: string; subs: string[] }>();
  for (const row of result.rows) {
    if (!grouped.has(row.cat_slug)) {
      grouped.set(row.cat_slug, { catName: row.cat_name, subs: [] });
    }
    grouped.get(row.cat_slug)!.subs.push(`${row.sub_slug} (${row.sub_name})`);
  }

  const lines: string[] = [];
  for (const [catSlug, { catName, subs }] of grouped) {
    lines.push(`- ${catSlug} (${catName}): ${subs.join(', ')}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Active duels for overlap check                                    */
/* ------------------------------------------------------------------ */

async function getActiveDuelTitles(): Promise<string[]> {
  const result = await pool.query(
    `SELECT title FROM duels WHERE status = 'active' AND (queue_status = 'live' OR queue_status IS NULL) ORDER BY created_at DESC LIMIT 100`,
  );
  return result.rows.map((r: any) => r.title);
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                     */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT_TEMPLATE = `You are a statement evaluator for a voting platform. Users create duels that can be:
- Binary (Agree/Disagree on a declarative statement)
- Multi-option (voters pick from a list — great for "Which X is best?" questions)
- Level/ranking (voters rate on a scale)

Think like an Oxford debate moderator, but also like a Polymarket listing curator.

CRITICAL RULE — READ THIS FIRST:
You are a GRAMMAR and FORMAT checker ONLY. You are NOT a fact-checker, NOT a misinformation detector, NOT a content moderator. You have exactly 3 rejection criteria listed below. If the statement does not match one of those 3, you MUST approve it. No exceptions.

You must NEVER reject or warn about:
- Factual accuracy or inaccuracy
- Whether something "really happened" or is "true"
- Whether a claim is "substantiated" or "evidence-based"
- Whether it might "confuse voters"
- Whether it presents "false events as fact"
- Misinformation, disinformation, or conspiracy theories
- Controversial, offensive, or extreme positions
- Whether a question is "too broad" or "subjective" — subjective comparison questions are the WHOLE POINT of the platform

ALL of these are valid debate topics. "Khamenei is dead" — approve it. "The moon landing was faked" — approve it. "Biden is a robot" — approve it. The voters decide what's true, not you.

VALID FORMATS — approve all of these:
- Declarative statements: "Remote work is more productive than office work"
- Yes/no questions: "Should Biden retire?"
- Prediction questions: "Who will win the primary?"
- Comparison questions: "Which city has the best quality of life?"
- Ranking questions: "What is the best programming language?"
- Superlative questions: "Who is the greatest athlete of all time?"
- Opinion polls: "What is the most overrated movie?"

Evaluate the user's submitted statement and respond in JSON only.

REJECT the statement (approved: false) ONLY if one of these 3 criteria is met:
1. It is grammatically broken or incoherent (cannot be understood)
2. It would produce an obvious or predictable outcome (>90% one-sided) — e.g. "food is good", "murder is bad", "puppies are cute". NOTE: broad comparison questions like "Which city is best?" are NOT predictable — they split opinion by definition.
3. It is too vague or meaningless to vote on (e.g. "things are stuff")

That's it. Nothing else is grounds for rejection.

OVERLAP CHECK:
Below is a list of currently active duels. Only flag overlap if the user's statement is essentially asking the SAME question or taking the SAME position as an existing duel -- i.e. someone voting on both would feel like they're voting on the same thing twice.

Do NOT flag as overlap:
- Same broad topic but different angle
- Same subject but opposite framing
- Same event but different takeaway

CURRENTLY ACTIVE DUELS:
{{ACTIVE_DUELS}}

If there is a near-duplicate, set "overlap" to the title of that duel. This is a soft warning, not a rejection.

APPROVE the statement (approved: true) if people would genuinely disagree on it OR if it invites diverse answers.

Always provide a "suggestion" -- a refined version:
- Under 120 characters
- If the original is a question (especially "which", "what", "who" comparisons), KEEP it as a question — do NOT convert to declarative
- If the original is a statement, refine as a declarative in present tense
- Short, provocative, and clear
- Designed to split opinion or invite diverse answers

Always provide "categorySlug" -- the best-fitting category slug from the available categories below. Use the category slug (not subcategory).

AVAILABLE CATEGORIES:
{{CATEGORIES}}

Respond in JSON only:
{"approved": true, "suggestion": "refined statement here", "categorySlug": "best-category-slug", "overlap": null}
or with overlap warning:
{"approved": true, "suggestion": "refined statement here", "categorySlug": "best-category-slug", "overlap": "title of similar active duel"}
or rejected:
{"approved": false, "reason": "brief explanation of why rejected", "suggestion": "refined statement here", "categorySlug": "best-category-slug", "overlap": null}`;

/* ------------------------------------------------------------------ */
/*  POST /api/evaluate-statement                                      */
/* ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  try {
    const { statement } = req.body;

    if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
      return res.status(400).json({ error: 'Statement is required' });
    }

    const trimmed = statement.trim();

    // 1. Profanity check first
    const profanityResult = checkProfanity({ statement: trimmed });
    if (!profanityResult.clean) {
      return res.status(400).json({
        approved: false,
        reason: `Statement contains inappropriate language`,
        suggestion: '',
        categorySlug: '',
      });
    }

    // 2. If no API key, pass through (approve with no suggestion)
    const anthropic = getClient();
    if (!anthropic) {
      return res.json({
        approved: true,
        suggestion: trimmed,
        categorySlug: '',
      });
    }

    // 3. Fetch categories + active duels and build prompt
    const [categoryList, activeTitles] = await Promise.all([
      getCategoryList(),
      getActiveDuelTitles(),
    ]);
    const activeDuelsText = activeTitles.length > 0
      ? activeTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(none currently active)';
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{{CATEGORIES}}', categoryList)
      .replace('{{ACTIVE_DUELS}}', activeDuelsText);

    // 4. Call Claude Sonnet
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Evaluate this statement: "${trimmed}"` },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    // 5. Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[evaluate] No JSON found in Sonnet response:', text);
      return res.json({
        approved: true,
        suggestion: trimmed,
        categorySlug: '',
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const result: {
      approved: boolean;
      reason?: string;
      suggestion: string;
      categorySlug: string;
      overlap?: string;
    } = {
      approved: !!parsed.approved,
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion.trim() : trimmed,
      categorySlug: typeof parsed.categorySlug === 'string' ? parsed.categorySlug.trim().toLowerCase() : '',
    };

    if (!parsed.approved && typeof parsed.reason === 'string') {
      result.reason = parsed.reason.trim();
    }

    if (typeof parsed.overlap === 'string' && parsed.overlap.trim().length > 0) {
      result.overlap = parsed.overlap.trim();
    }

    return res.json(result);
  } catch (err: any) {
    console.error('[evaluate] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to evaluate statement' });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/evaluate-statement/suggest                               */
/*  Generate a duel prompt from a theme or description                 */
/* ------------------------------------------------------------------ */

const SUGGEST_PROMPT_TEMPLATE = `You are a creative duel prompt generator for a prediction/debate platform.

TODAY'S DATE: {{TODAY}}

RULES:
- Generate a compelling, controversial, thought-provoking duel prompt that splits opinion
- Clear and concise (under 120 characters)
- NEVER generate anything with profanity, slurs, or hate speech
- If the prompt references a year, use the CURRENT year ({{YEAR}}) unless the user specifically asks about a different time
- Every generation must be DIFFERENT and ORIGINAL — never repeat yourself
- Distribute EQUALLY across all three duel types (roughly 1/3 each):
  * "binary" — a declarative statement people agree/disagree on (e.g. "Remote work is more productive than office work")
  * "multi" — a comparison question with multiple answers (e.g. "Which city has the best quality of life?")
  * "level" — a rating/scale question (e.g. "How much of a threat is AI to humanity?")
- Use the duel type hint provided in the user message if given. Otherwise pick whichever fits the topic best.
- For "multi" type, also generate 3-5 starter options
- For "level" type, also generate 3-5 scale labels (e.g. "No threat", "Moderate", "Existential")

TOPIC INSPIRATION — use the subcategories below as specific topic areas to draw from. Each subcategory represents a real topic people debate. Your prompt should be about something specific within one of these topic areas, not just the broad category.
- Pick the BEST fitting category AND subcategory.
- Use EXACTLY one of the provided category slugs for categorySlug.
- Use EXACTLY one of the provided subcategory slugs for subcategorySlug.

CATEGORIES AND SUBCATEGORIES:
{{CATEGORIES}}

OVERLAP CHECK — these duels are CURRENTLY LIVE on the platform. Do NOT generate anything that asks essentially the same question or takes the same position. Your suggestion must be clearly distinct from all of these:
{{ACTIVE_DUELS}}

Respond in JSON only:
{
  "title": "the duel prompt",
  "duelType": "binary" | "multi" | "level",
  "categorySlug": "category-slug",
  "subcategorySlug": "subcategory-slug",
  "options": ["option1", "option2", "option3"] // only for multi or level types, omit for binary
}`;

const CATEGORY_ROTATION = [
  'Politics', 'Tech & AI', 'Culture', 'Economy', 'Geopolitics',
  'Climate & Science', 'World', 'Elections',
];
let _suggestRotationIdx = 0;

router.post('/suggest', async (req: Request, res: Response) => {
  try {
    const { theme, retryCount } = req.body;
    const trimmedTheme = (typeof theme === 'string' ? theme.trim() : '') || '';

    const anthropic = getClient();
    if (!anthropic) {
      return res.status(503).json({ error: 'AI service not available' });
    }

    // Full category + subcategory list so Sonnet can pick precise subcategories
    const [categoryList, activeTitles] = await Promise.all([
      getCategoryList(),
      getActiveDuelTitles(),
    ]);
    const catResult = await pool.query(`SELECT slug FROM categories ORDER BY slug`);
    const catSlugs = catResult.rows.map((r: any) => r.slug as string);
    const subResult = await pool.query(`SELECT s.slug, c.slug AS cat_slug FROM subcategories s JOIN categories c ON c.id = s.category_id`);
    const subSlugToCat = new Map<string, string>();
    for (const row of subResult.rows) subSlugToCat.set(row.slug, row.cat_slug);

    const activeDuelsText = activeTitles.length > 0
      ? activeTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(none currently live)';

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear().toString();
    const systemPrompt = SUGGEST_PROMPT_TEMPLATE
      .replace('{{CATEGORIES}}', categoryList)
      .replace('{{ACTIVE_DUELS}}', activeDuelsText)
      .replace(/\{\{TODAY\}\}/g, today)
      .replace(/\{\{YEAR\}\}/g, year);

    // Rotate duel types equally across calls
    const DUEL_TYPE_ROTATION = ['binary', 'multi', 'level'] as const;
    const typeHint = DUEL_TYPE_ROTATION[(_suggestRotationIdx + (retryCount || 0)) % 3];

    // Build user message with variation hints
    let userMessage: string;
    if (trimmedTheme) {
      const retryHint = (retryCount && retryCount > 0)
        ? ` This is attempt #${retryCount + 1} — generate something COMPLETELY DIFFERENT from any previous suggestion.`
        : '';
      userMessage = `Generate a "${typeHint}" duel prompt based on this theme: "${trimmedTheme}"${retryHint}`;
    } else {
      // No theme — rotate through categories
      const category = CATEGORY_ROTATION[_suggestRotationIdx % CATEGORY_ROTATION.length];
      _suggestRotationIdx++;
      userMessage = `Generate a surprising, original "${typeHint}" duel prompt in the "${category}" category. Make it unexpected and timely for ${year}.`;
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      temperature: 1,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to generate suggestion' });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate categorySlug against actual DB categories
    let catSlug = typeof parsed.categorySlug === 'string' ? parsed.categorySlug.trim().toLowerCase() : '';
    if (!catSlugs.includes(catSlug)) catSlug = catSlugs[0] || '';

    // Validate subcategorySlug — must exist and belong to the selected category
    let subSlug = typeof parsed.subcategorySlug === 'string' ? parsed.subcategorySlug.trim().toLowerCase() : '';
    if (subSlug && subSlugToCat.has(subSlug)) {
      // If subcategory exists but belongs to a different category, use the subcategory's actual parent
      const actualCat = subSlugToCat.get(subSlug)!;
      if (actualCat !== catSlug) catSlug = actualCat;
    } else {
      subSlug = ''; // invalid subcategory — frontend will auto-resolve
    }

    return res.json({
      title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
      duelType: ['binary', 'multi', 'level'].includes(parsed.duelType) ? parsed.duelType : 'binary',
      categorySlug: catSlug,
      subcategorySlug: subSlug || undefined,
      options: Array.isArray(parsed.options) ? parsed.options.filter((o: any) => typeof o === 'string' && o.trim()).map((o: any) => o.trim()) : undefined,
    });
  } catch (err: any) {
    console.error('[evaluate:suggest] Error:', err?.message);
    return res.status(500).json({ error: 'Failed to generate suggestion' });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/evaluate-statement/staking-info                           */
/*  Returns platform avg votes for client-side reward estimation       */
/* ------------------------------------------------------------------ */

router.get('/staking-info', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT AVG(total_votes)::float AS avg_votes, COUNT(*)::int AS cnt
      FROM (
        SELECT total_votes
        FROM duels
        WHERE queue_status = 'live'
          AND stake_status IN ('rewarded', 'burned')
          AND status = 'ended'
        ORDER BY stake_resolved_at DESC NULLS LAST
        LIMIT 100
      ) recent
    `);

    const { avg_votes, cnt } = result.rows[0] || {};
    const avgVotes = (!cnt || cnt < 10) ? 5 : (avg_votes || 5);

    return res.json({
      avgVotes: Math.round(avgVotes * 10) / 10,
      minVotesThreshold: 10,
      maxReward: 1000,
      minStake: 10,
    });
  } catch (err: any) {
    console.error('[evaluate] staking-info error:', err?.message);
    return res.json({ avgVotes: 5, minVotesThreshold: 10, maxReward: 1000, minStake: 10 });
  }
});

export default router;
