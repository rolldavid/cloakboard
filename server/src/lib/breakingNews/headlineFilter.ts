/**
 * Headline quality filter — uses Claude Haiku to evaluate whether a news
 * headline describes a factual event suitable for a Support/Oppose vote.
 *
 * Rejects: speculation, claims, beliefs, opinions, predictions, rumors.
 * Accepts: concrete actions, announcements, events, releases, decisions.
 */

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

const SYSTEM_PROMPT = `You evaluate news headlines for a voting platform where users vote Support or Oppose on breaking news events.

Your job: determine if a headline (1) describes a FACTUAL EVENT that actually happened or is happening, AND (2) is something people can meaningfully SUPPORT or OPPOSE — i.e., it involves a human decision, policy, action, or controversy where reasonable people could disagree.

ACCEPT headlines about:
- Policy actions: "Trump imposes tariffs on...", "EU passes new regulation...", "Country bans..."
- Controversial decisions: "Supreme Court rules...", "NASA cancels mission...", "Company lays off 500..."
- Political/social events: "Ceasefire agreement signed...", "Protests erupt over...", "Workers go on strike..."
- Announcements with impact: "Amazon announces new HQ...", "Government cuts funding for..."

REJECT headlines about:
- Beliefs/claims: "US believes Iran may...", "Trump claims...", "Sources say..."
- Speculation: "Could this mean...", "May lead to...", "Experts warn..."
- Opinions/reactions: "Critics slam...", "Fans react to...", "Why X is wrong about..."
- Rumors: "Reportedly...", "Allegedly...", "Sources suggest..."
- Predictions: "Expected to...", "Likely to...", "Set to..."
- Questions: "Will X happen?", "Is Y the answer?"
- Natural/inevitable events with no human agency: "Defunct satellite to crash to Earth", "Solar eclipse visible from...", "Asteroid passes near Earth"
- Neutral factual updates with nothing to oppose: "Stock market closes at...", "Census data released", "Weather forecast updated"
- Celebrity gossip or entertainment without substance: "Celebrity spotted at...", "New trailer released for..."

Respond with ONLY "ACCEPT" or "REJECT" — nothing else.`;

export interface HeadlineEvaluation {
  accepted: boolean;
  title: string;
}

/**
 * Evaluate a headline using Claude Haiku.
 * Returns true if the headline describes a factual event suitable for voting.
 * Falls back to a keyword filter if the API is unavailable.
 */
export async function evaluateHeadline(title: string, description: string): Promise<boolean> {
  const anthropic = getClient();

  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Headline: "${title}"\nSummary: "${description}"` },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      return text.toUpperCase().startsWith('ACCEPT');
    } catch (err: any) {
      console.warn('[headlineFilter] Claude API error, falling back to keyword filter:', err?.message);
    }
  }

  // Fallback: keyword-based filter
  return keywordFilter(title);
}

/**
 * Simple keyword filter as fallback when Claude API is unavailable.
 */
function keywordFilter(title: string): boolean {
  const lower = title.toLowerCase();

  const REJECT_PATTERNS = [
    /\b(believes?|claimed?|claims|alleges?|allegedly)\b/,
    /\b(may|might|could|would)\s+(be|have|do|lead|cause|deploy|start|end)/,
    /\b(reportedly|rumor|rumour|sources?\s+say|sources?\s+suggest)\b/,
    /\b(expected\s+to|likely\s+to|set\s+to|predicted?\s+to)\b/,
    /\b(warns?|warning|fears?|worries)\b/,
    /\b(opinion|editorial|commentary|analysis)\b/i,
    /\b(reacts?\s+to|slams?|blasts?|rips)\b/,
    /\?\s*$/,  // Headlines ending with question marks
  ];

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(lower)) return false;
  }

  return true;
}
