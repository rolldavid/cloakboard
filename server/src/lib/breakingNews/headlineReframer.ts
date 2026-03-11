/**
 * Headline reframer — uses Claude Sonnet to pick the most compelling headlines
 * and reframe them as bold agree/disagree statements for the voting platform.
 *
 * Combines filtering + ranking + reframing in a single LLM call.
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

export interface ReframedHeadline {
  index: number;
  statement: string;
}

const SYSTEM_PROMPT = `You are an editor for a global news voting platform where users vote Agree or Disagree on statements about current events. Your audience is international -- do not assume a US-centric worldview.

Given a list of today's top headlines, select up to 2 that would make the most compelling public debates. Then reframe each into a bold, generalized agree/disagree statement.

SELECTION CRITERIA -- pick headlines that:
- Are about events people actually care about and have strong opinions on
- Involve human decisions, policies, controversies, or consequential actions
- Would generate genuine disagreement -- not unanimous agreement or apathy
- Are significant enough to warrant global attention (not hyper-local or niche)

SKIP headlines that are:
- Financial analysis, stock picks, or investment advice
- Product unboxings, reviews, or release dates (unless culturally significant)
- Celebrity gossip without broader implications
- Hyper-local news (regional politics, local infrastructure)
- FDA notices, regulatory filings, coupon deals
- Sports trades, fantasy picks, or game scores
- Neutral factual updates nobody would disagree with
- Natural events with no human agency

REFRAMING RULES:
- Write a declarative STATEMENT (not a question)
- Generalize beyond the specific headline into a broader take
- Make it somewhat provocative -- reasonable people should disagree
- Keep it concise (under 120 characters)
- Use present tense
- Do not include source names or specific dates
- Frame from a globally neutral perspective -- do not default to Western or US framing
- Do not assume any country is inherently more democratic, free, or moral than another
- Avoid framing that positions the US/West as a default "good" side or moral authority
- All governments and power structures should be subject to equal scrutiny
- Statements should be debatable by people across different political systems and cultures

LABELING AND FRAMING:
- "Terrorist" is a politically loaded label -- many resistance and liberation movements are designated as terrorist groups by the states they oppose. Do not uncritically adopt state designations. Frame around the actions and context, not the label.
- State violence (military operations, drone strikes, sanctions, occupation) should be scrutinized with the same moral weight as non-state violence. Do not frame state violence as inherently legitimate.
- Do not promote or glorify violence from any actor, but do not assume non-state actors are inherently wrong or that state actors are inherently justified.

EXAMPLES:
- Headline: "Trump Administration Struggles to Contain Soaring Gas Prices"
  Statement: "The Trump administration's policies are making gas prices worse"

- Headline: "China's new humanoid robot framework enables breakdance and backflips"
  Statement: "China is pulling ahead of the US in the global robotics race"

- Headline: "EU passes sweeping AI regulation bill"
  Statement: "Heavy AI regulation will hurt innovation more than it helps"

- Headline: "Journalists face restrictions, detention covering Mideast war"
  Statement: "Press freedom is being dangerously eroded in the Middle East conflict"

- Headline: "US imposes new sanctions on Venezuelan oil exports"
  Statement: "Economic sanctions cause more harm to ordinary people than to the regimes they target"

- Headline: "India and China hold border talks amid troop buildup"
  Statement: "Diplomatic talks between rival powers are more effective than military posturing"

Respond in JSON only:
{"picks": [{"index": 0, "statement": "..."}, {"index": 3, "statement": "..."}]}

If fewer than 2 are worth picking, return fewer. If none, return {"picks": []}.`;

/**
 * Pick and reframe the top headlines from a list of candidates.
 * Returns up to 2 reframed statements with their original indices.
 */
export async function pickAndReframe(
  headlines: { title: string; description: string; source: string }[],
): Promise<ReframedHeadline[]> {
  const anthropic = getClient();
  if (!anthropic || headlines.length === 0) return [];

  const numbered = headlines
    .map((h, i) => `${i}. "${h.title}" — ${h.source}\n   Summary: ${h.description?.slice(0, 200) || 'N/A'}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Today's top headlines:\n\n${numbered}` },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[headlineReframer] No JSON found in response:', text);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.picks)) return [];

    return parsed.picks
      .filter((p: any) =>
        typeof p.index === 'number' &&
        typeof p.statement === 'string' &&
        p.index >= 0 &&
        p.index < headlines.length &&
        p.statement.trim().length > 10 &&
        p.statement.trim().length <= 200,
      )
      .slice(0, 2)
      .map((p: any) => ({
        index: p.index,
        statement: p.statement.trim(),
      }));
  } catch (err: any) {
    console.error('[headlineReframer] Sonnet API error:', err?.message);
    return [];
  }
}
