/**
 * Seed 235 votes from vote.json into the database.
 * Run: cd server && npx tsx scripts/seedVotes.ts
 *
 * - Creates subcategories (ON CONFLICT upsert)
 * - Inserts duels with proper timing fields
 * - Creates options/levels for multi/level duels
 * - Creates first period for recurring duels (EST-aligned)
 * - Leaves on_chain_id = NULL — cron picks them up
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────────────

const ENV_PATH = resolve(__dirname, '../.env.local');
const VOTE_JSON_PATH = resolve(__dirname, '../../../plans/data/vote.json');
const KEEPER_ADDRESS = '0x2d5c737ae888f63c4e37b71ca2f2ca67f2bd9f08529bdee92a8505e09a98fbc0';
const EST_OFFSET_H = 5;

// Category name mapping: vote.json name → DB name
const CATEGORY_ALIAS: Record<string, string> = {
  'Tech': 'Tech & AI',
};

// Duration string → seconds
const DURATION_SECONDS: Record<string, number> = {
  '1 hour': 3600,
  '1 day': 86400,
  '1 week': 604800,
  '1 month': 2592000,
  '1 year': 31536000,
};

// ── Types ───────────────────────────────────────────────────────────────────

interface VoteEntry {
  type: 'binary' | 'multi' | 'level';
  statement: string;
  recurring: false | { interval: 'daily' | 'monthly' | 'yearly' };
  duration?: string;
  options?: string[];
  levels?: string[];
}

interface SubcategoryEntry {
  name: string;
  votes: VoteEntry[];
}

interface CategoryEntry {
  name: string;
  subcategories: SubcategoryEntry[];
}

interface VoteJson {
  categories: CategoryEntry[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadEnv(path: string) {
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

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

function computeTimingFields(vote: VoteEntry): {
  timingType: string;
  endsAt: string | null;
  durationSeconds: number | null;
  recurrence: string | null;
} {
  if (vote.recurring && vote.recurring !== false) {
    return {
      timingType: 'recurring',
      endsAt: null,
      durationSeconds: null,
      recurrence: vote.recurring.interval,
    };
  }

  const dur = vote.duration || 'never ends';
  if (dur === 'never ends') {
    return {
      timingType: 'end_time',
      endsAt: '2099-12-31T23:59:59Z',
      durationSeconds: null,
      recurrence: null,
    };
  }

  const seconds = DURATION_SECONDS[dur];
  if (!seconds) throw new Error(`Unknown duration: ${dur}`);
  const endsAt = new Date(Date.now() + seconds * 1000).toISOString();
  return {
    timingType: 'duration',
    endsAt,
    durationSeconds: seconds,
    recurrence: null,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv(ENV_PATH);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = new Pool({ connectionString: dbUrl });
  const data: VoteJson = JSON.parse(readFileSync(VOTE_JSON_PATH, 'utf-8'));

  // 1. Build category name→id map
  const catRows = await pool.query('SELECT id, name FROM categories');
  const catMap = new Map<string, number>();
  for (const row of catRows.rows) {
    catMap.set(row.name, row.id);
  }

  // Track used slugs to avoid collisions within this run
  const usedSlugs = new Set<string>();
  // Pre-load existing slugs
  const existingSlugs = await pool.query('SELECT slug FROM duels WHERE slug IS NOT NULL');
  for (const row of existingSlugs.rows) usedSlugs.add(row.slug);

  const stats = { binary: 0, multi: 0, level: 0, subcategories: 0, periods: 0 };

  for (const cat of data.categories) {
    const dbName = CATEGORY_ALIAS[cat.name] || cat.name;
    const categoryId = catMap.get(dbName);
    if (!categoryId) {
      console.error(`Category not found in DB: "${dbName}" (from "${cat.name}")`);
      continue;
    }

    console.log(`\n=== ${dbName} (id=${categoryId}) ===`);

    for (const sub of cat.subcategories) {
      const subSlug = slugify(sub.name) || 'general';

      // Upsert subcategory
      const subResult = await pool.query(
        `INSERT INTO subcategories (category_id, name, slug, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (category_id, slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [categoryId, sub.name, subSlug, KEEPER_ADDRESS],
      );
      const subcategoryId = subResult.rows[0].id;
      stats.subcategories++;
      console.log(`  Subcategory: ${sub.name} (id=${subcategoryId})`);

      for (const vote of sub.votes) {
        const { timingType, endsAt, durationSeconds, recurrence } = computeTimingFields(vote);

        // Generate unique slug
        let duelSlug = slugify(vote.statement) || 'duel';
        if (usedSlugs.has(duelSlug)) {
          for (let i = 0; i < 5; i++) {
            const suffix = Math.floor(Math.random() * 9000 + 1000);
            const candidate = `${duelSlug}-${suffix}`;
            if (!usedSlugs.has(candidate)) { duelSlug = candidate; break; }
          }
          if (usedSlugs.has(duelSlug)) duelSlug = `${duelSlug}-${Date.now()}`;
        }
        usedSlugs.add(duelSlug);

        // Insert duel
        const duelResult = await pool.query(
          `INSERT INTO duels (
            title, duel_type, timing_type, subcategory_id,
            ends_at, duration_seconds, recurrence, created_by, slug,
            level_low_label, level_high_label,
            chart_mode, chart_top_n
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id`,
          [
            vote.statement,
            vote.type,
            timingType,
            subcategoryId,
            endsAt,
            durationSeconds,
            recurrence,
            KEEPER_ADDRESS,
            duelSlug,
            vote.type === 'level' && vote.levels ? vote.levels[0] : null,
            vote.type === 'level' && vote.levels ? vote.levels[vote.levels.length - 1] : null,
            vote.type === 'multi' ? 'top_n' : null,
            vote.type === 'multi' ? 5 : null,
          ],
        );
        const duelId = duelResult.rows[0].id;
        stats[vote.type]++;

        // Insert options for multi
        if (vote.type === 'multi' && vote.options) {
          await pool.query(
            `INSERT INTO duel_options (duel_id, label, added_by)
             SELECT $1, unnest($2::text[]), $3`,
            [duelId, vote.options, KEEPER_ADDRESS],
          );
        }

        // Insert levels for level
        if (vote.type === 'level' && vote.levels) {
          const levelNumbers = vote.levels.map((_, i) => i + 1);
          await pool.query(
            `INSERT INTO duel_levels (duel_id, level, label)
             SELECT $1, unnest($2::int[]), unnest($3::text[])`,
            [duelId, levelNumbers, vote.levels],
          );
        }

        // Initial vote snapshot
        await pool.query(
          `INSERT INTO vote_snapshots (duel_id, agree_count, disagree_count, total_votes)
           VALUES ($1, 0, 0, 0)`,
          [duelId],
        );

        // Create first period for recurring duels
        if (timingType === 'recurring' && recurrence) {
          const now = new Date();
          const periodEnd = computeCalendarPeriodEnd(recurrence, now);
          const periodSlug = generatePeriodSlug(recurrence, now);

          const periodResult = await pool.query(
            `INSERT INTO duel_periods (duel_id, period_start, period_end, slug, status)
             VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
            [duelId, now.toISOString(), periodEnd.toISOString(), periodSlug],
          );
          const periodId = periodResult.rows[0].id;
          stats.periods++;

          // Period option votes for multi
          if (vote.type === 'multi' && vote.options) {
            await pool.query(
              `INSERT INTO period_option_votes (period_id, option_id)
               SELECT $1, id FROM duel_options WHERE duel_id = $2 ORDER BY id`,
              [periodId, duelId],
            );
          }

          // Period level votes for level
          if (vote.type === 'level' && vote.levels) {
            await pool.query(
              `INSERT INTO period_level_votes (period_id, duel_id, level)
               SELECT $1, $2, level FROM duel_levels WHERE duel_id = $2 ORDER BY level`,
              [periodId, duelId],
            );
          }
        }

        console.log(`    [${vote.type}] ${vote.statement.slice(0, 60)}... (${timingType})`);
      }
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('SEED COMPLETE');
  console.log(`  Binary:        ${stats.binary}`);
  console.log(`  Multi:         ${stats.multi}`);
  console.log(`  Level:         ${stats.level}`);
  console.log(`  Total duels:   ${stats.binary + stats.multi + stats.level}`);
  console.log(`  Subcategories: ${stats.subcategories}`);
  console.log(`  Periods:       ${stats.periods}`);
  console.log('========================================');

  // Verification queries
  const typeCount = await pool.query('SELECT duel_type, count(*) FROM duels GROUP BY duel_type ORDER BY duel_type');
  console.log('\nVerification (duels by type):');
  for (const row of typeCount.rows) console.log(`  ${row.duel_type}: ${row.count}`);

  const subCount = await pool.query('SELECT count(*) FROM subcategories');
  console.log(`Subcategories: ${subCount.rows[0].count}`);

  const periodCount = await pool.query(
    `SELECT count(*) FROM duel_periods dp JOIN duels d ON dp.duel_id = d.id WHERE d.timing_type = 'recurring'`,
  );
  console.log(`Active periods: ${periodCount.rows[0].count}`);

  await pool.end();
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
