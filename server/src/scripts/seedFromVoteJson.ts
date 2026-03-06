/**
 * Seed script: Clear all duel data from prod DB and re-seed from vote.json.
 *
 * Usage: DATABASE_URL=<prod_url> npx tsx src/scripts/seedFromVoteJson.ts
 *
 * - Clears: duels, duel_options, duel_levels, duel_periods, period_option_votes,
 *   period_level_votes, vote_snapshots, comments, comment_votes
 * - Keeps: categories, subcategories, users, google_user_salts
 * - Creates first calendar-aligned period for recurring duels
 * - Leaves on_chain_id NULL — keeper cron deploys everything on-chain
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Calendar period helpers (copied from calendarPeriods.ts to avoid import issues) ───

const EST_OFFSET_H = 5;

function estComponents(date: Date): { y: number; m: number; d: number } {
  const estMs = date.getTime() - EST_OFFSET_H * 3_600_000;
  const shifted = new Date(estMs);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

function computeCalendarPeriodEnd(recurrence: string, periodStart: Date): Date {
  const { y, m, d } = estComponents(periodStart);
  switch (recurrence) {
    case 'daily':   return new Date(Date.UTC(y, m, d + 1, EST_OFFSET_H));
    case 'monthly': return new Date(Date.UTC(y, m + 1, 1, EST_OFFSET_H));
    case 'yearly':  return new Date(Date.UTC(y + 1, 0, 1, EST_OFFSET_H));
    default:        return new Date(Date.UTC(y, m, d + 1, EST_OFFSET_H));
  }
}

function generatePeriodSlug(recurrence: string, periodStart: Date): string {
  const { y, m, d } = estComponents(periodStart);
  const ms = String(m + 1).padStart(2, '0');
  const ds = String(d).padStart(2, '0');
  switch (recurrence) {
    case 'daily':   return `${y}-${ms}-${ds}`;
    case 'monthly': return `${y}-${ms}`;
    case 'yearly':  return `${y}`;
    default:        return `${y}-${ms}-${ds}`;
  }
}

// ─── Slug generation ───

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ─── Duration parsing ───

function parseDuration(duration: string): { timingType: string; durationSeconds: number | null; endsAt: Date | null } {
  if (duration === 'never ends') {
    return { timingType: 'end_time', durationSeconds: null, endsAt: null };
  }
  const map: Record<string, number> = {
    '1 hour': 3600,
    '1 day': 86400,
    '1 week': 604800,
    '1 month': 2592000,
    '1 year': 31536000,
  };
  const seconds = map[duration];
  if (!seconds) throw new Error(`Unknown duration: ${duration}`);
  return {
    timingType: 'duration',
    durationSeconds: seconds,
    endsAt: new Date(Date.now() + seconds * 1000),
  };
}

// ─── Category name mapping (vote.json name → DB name) ───

const CATEGORY_NAME_MAP: Record<string, string> = {
  'Tech': 'Tech & AI',
  'Politics': 'Politics',
  'Geopolitics': 'Geopolitics',
  'Culture': 'Culture',
  'World': 'World',
  'Economy': 'Economy',
  'Climate & Science': 'Climate & Science',
  'Elections': 'Elections',
};

// ─── Main ───

interface VoteJson {
  categories: Array<{
    name: string;
    color: string;
    icon: string;
    subcategories: Array<{
      name: string;
      votes: Array<{
        type: 'binary' | 'multi' | 'level';
        statement: string;
        options?: string[];
        levels?: string[];
        recurring: false | { interval: string };
        duration?: string;
      }>;
    }>;
  }>;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    // Load vote.json
    const voteJsonPath = resolve(__dirname, '../../../../plans/data/vote.json');
    const data: VoteJson = JSON.parse(readFileSync(voteJsonPath, 'utf-8'));

    // Load category/subcategory mappings from DB
    const catRows = await pool.query('SELECT id, name FROM categories');
    const catByName = new Map<string, number>();
    for (const r of catRows.rows) catByName.set(r.name, r.id);

    const subRows = await pool.query('SELECT id, category_id, name FROM subcategories');
    const subByKey = new Map<string, number>(); // "catId:subName" → subcategory id
    for (const r of subRows.rows) subByKey.set(`${r.category_id}:${r.name}`, r.id);

    // ─── Step 1: Clear all duel-related data ───
    console.log('Clearing duel data...');
    await pool.query(`
      DELETE FROM vote_snapshots;
      DELETE FROM period_option_votes;
      DELETE FROM period_level_votes;
      DELETE FROM comment_votes;
      DELETE FROM comments;
      DELETE FROM duel_periods;
      DELETE FROM duel_options;
      DELETE FROM duel_levels;
      DELETE FROM duels;
    `);

    // Reset sequences
    await pool.query(`
      ALTER SEQUENCE duels_id_seq RESTART WITH 1;
      ALTER SEQUENCE duel_options_id_seq RESTART WITH 1;
      ALTER SEQUENCE duel_periods_id_seq RESTART WITH 1;
      ALTER SEQUENCE vote_snapshots_id_seq RESTART WITH 1;
      ALTER SEQUENCE comments_id_seq RESTART WITH 1;
      ALTER SEQUENCE comment_votes_id_seq RESTART WITH 1;
    `);
    console.log('Cleared and reset sequences.');

    // ─── Step 2: Seed duels ───
    const usedSlugs = new Set<string>();
    const now = new Date();
    let totalDuels = 0;
    let totalPeriods = 0;
    let totalOptions = 0;
    let totalLevels = 0;

    for (const cat of data.categories) {
      const dbCatName = CATEGORY_NAME_MAP[cat.name];
      if (!dbCatName) {
        console.warn(`Unknown category: ${cat.name}, skipping`);
        continue;
      }
      const catId = catByName.get(dbCatName);
      if (!catId) {
        console.warn(`Category not in DB: ${dbCatName}, skipping`);
        continue;
      }

      for (const sub of cat.subcategories) {
        const subId = subByKey.get(`${catId}:${sub.name}`);
        if (!subId) {
          console.warn(`Subcategory not in DB: ${dbCatName} > ${sub.name}, skipping`);
          continue;
        }

        for (const vote of sub.votes) {
          // Determine timing
          let timingType: string;
          let recurrence: string | null = null;
          let durationSeconds: number | null = null;
          let endsAt: Date | null = null;

          if (vote.recurring) {
            timingType = 'recurring';
            recurrence = vote.recurring.interval;
          } else {
            const parsed = parseDuration(vote.duration || 'never ends');
            timingType = parsed.timingType;
            durationSeconds = parsed.durationSeconds;
            endsAt = parsed.endsAt;
          }

          // Generate unique slug
          let slug = slugify(vote.statement);
          if (usedSlugs.has(slug)) {
            const suffix = Math.floor(Math.random() * 9000 + 1000);
            slug = `${slug}-${suffix}`;
          }
          usedSlugs.add(slug);

          // Insert duel
          const duelResult = await pool.query(`
            INSERT INTO duels (
              title, description, duel_type, timing_type, subcategory_id,
              ends_at, starts_at, duration_seconds, recurrence,
              created_by, level_low_label, level_high_label,
              chart_mode, chart_top_n, end_block, slug, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'active')
            RETURNING id
          `, [
            vote.statement,
            null, // description
            vote.type,
            timingType,
            subId,
            timingType === 'recurring' ? null : (endsAt?.toISOString() || null),
            null, // starts_at
            durationSeconds,
            recurrence,
            'system', // created_by
            vote.type === 'level' ? (vote.levels?.[0] || null) : null,
            vote.type === 'level' ? (vote.levels?.[vote.levels.length - 1] || null) : null,
            vote.type === 'multi' ? 'top_n' : null,
            vote.type === 'multi' ? 5 : null,
            null, // end_block — keeper will set
            slug,
          ]);
          const duelId = duelResult.rows[0].id;
          totalDuels++;

          // Insert options for multi duels
          if (vote.type === 'multi' && vote.options) {
            await pool.query(
              `INSERT INTO duel_options (duel_id, label, added_by)
               SELECT $1, unnest($2::text[]), 'system'`,
              [duelId, vote.options],
            );
            totalOptions += vote.options.length;
          }

          // Insert levels for level duels
          if (vote.type === 'level' && vote.levels) {
            const levelNumbers = vote.levels.map((_, i) => i + 1);
            await pool.query(
              `INSERT INTO duel_levels (duel_id, level, label)
               SELECT $1, unnest($2::int[]), unnest($3::text[])`,
              [duelId, levelNumbers, vote.levels],
            );
            totalLevels += vote.levels.length;
          }

          // Create first period for recurring duels (calendar-aligned from now)
          if (timingType === 'recurring' && recurrence) {
            const periodEnd = computeCalendarPeriodEnd(recurrence, now);
            const periodSlug = generatePeriodSlug(recurrence, now);

            const periodResult = await pool.query(
              `INSERT INTO duel_periods (duel_id, period_start, period_end, slug, end_block, status)
               VALUES ($1, $2, $3, $4, NULL, 'active') RETURNING id`,
              [duelId, now.toISOString(), periodEnd.toISOString(), periodSlug],
            );
            const periodId = periodResult.rows[0].id;
            totalPeriods++;

            // Per-period option votes for multi recurring duels
            if (vote.type === 'multi') {
              await pool.query(
                `INSERT INTO period_option_votes (period_id, option_id)
                 SELECT $1, id FROM duel_options WHERE duel_id = $2 ORDER BY id`,
                [periodId, duelId],
              );
            }

            // Per-period level votes for level recurring duels
            if (vote.type === 'level') {
              await pool.query(
                `INSERT INTO period_level_votes (period_id, duel_id, level)
                 SELECT $1, $2, level FROM duel_levels WHERE duel_id = $2 ORDER BY level`,
                [periodId, duelId],
              );
            }
          }

          // Insert initial snapshot
          await pool.query(
            `INSERT INTO vote_snapshots (duel_id, agree_count, disagree_count, total_votes) VALUES ($1, 0, 0, 0)`,
            [duelId],
          );
        }
      }
    }

    // ─── Step 3: Verify ───
    const verification = await pool.query(`
      SELECT
        (SELECT count(*) FROM duels) AS duels,
        (SELECT count(*) FROM duel_options) AS options,
        (SELECT count(*) FROM duel_levels) AS levels,
        (SELECT count(*) FROM duel_periods) AS periods,
        (SELECT count(*) FROM period_option_votes) AS period_opts,
        (SELECT count(*) FROM period_level_votes) AS period_lvls,
        (SELECT count(*) FROM vote_snapshots) AS snapshots,
        (SELECT count(*) FROM duels WHERE timing_type = 'recurring') AS recurring,
        (SELECT count(*) FROM duels WHERE timing_type != 'recurring') AS non_recurring,
        (SELECT count(*) FROM duels WHERE on_chain_id IS NULL) AS pending_onchain,
        (SELECT count(*) FROM duel_periods WHERE on_chain_id IS NULL) AS pending_period_onchain
    `);
    const v = verification.rows[0];

    console.log('\n=== Seed Complete ===');
    console.log(`Duels:          ${v.duels} (inserted: ${totalDuels})`);
    console.log(`Options:        ${v.options} (inserted: ${totalOptions})`);
    console.log(`Levels:         ${v.levels} (inserted: ${totalLevels})`);
    console.log(`Periods:        ${v.periods} (inserted: ${totalPeriods})`);
    console.log(`Period opts:    ${v.period_opts}`);
    console.log(`Period lvls:    ${v.period_lvls}`);
    console.log(`Snapshots:      ${v.snapshots}`);
    console.log(`Recurring:      ${v.recurring}`);
    console.log(`Non-recurring:  ${v.non_recurring}`);
    console.log(`\nPending on-chain (duels):   ${v.pending_onchain}`);
    console.log(`Pending on-chain (periods): ${v.pending_period_onchain}`);
    console.log('\nAll on_chain_ids are NULL — start the keeper server to deploy on-chain.');

  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
