import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path: string) {
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || !t) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnv(resolve(__dirname, '../.env.local'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // Non-recurring duels
  const nonRec = await pool.query(`
    SELECT
      count(*) FILTER (WHERE on_chain_id IS NOT NULL) as onchain,
      count(*) FILTER (WHERE on_chain_id IS NULL) as pending,
      count(*) as total
    FROM duels WHERE timing_type != 'recurring'
  `);
  console.log('Non-recurring duels:');
  console.log('  On-chain:', nonRec.rows[0].onchain);
  console.log('  Pending:', nonRec.rows[0].pending);
  console.log('  Total:', nonRec.rows[0].total);

  // Recurring periods
  const rec = await pool.query(`
    SELECT
      count(*) FILTER (WHERE dp.on_chain_id IS NOT NULL) as onchain,
      count(*) FILTER (WHERE dp.on_chain_id IS NULL) as pending,
      count(*) as total
    FROM duel_periods dp
    JOIN duels d ON dp.duel_id = d.id
    WHERE dp.status = 'active'
  `);
  console.log('\nRecurring periods:');
  console.log('  On-chain:', rec.rows[0].onchain);
  console.log('  Pending:', rec.rows[0].pending);
  console.log('  Total:', rec.rows[0].total);

  // Overall
  const totalOnchain = parseInt(nonRec.rows[0].onchain) + parseInt(rec.rows[0].onchain);
  const totalPending = parseInt(nonRec.rows[0].pending) + parseInt(rec.rows[0].pending);
  const totalAll = parseInt(nonRec.rows[0].total) + parseInt(rec.rows[0].total);
  console.log(`\nOverall: ${totalOnchain}/${totalAll} on-chain (${totalPending} pending)`);

  if (totalPending > 0) {
    // Show a few pending examples
    const examples = await pool.query(`
      SELECT d.id, d.title, d.timing_type, d.on_chain_id
      FROM duels d
      WHERE d.on_chain_id IS NULL AND d.timing_type != 'recurring'
      LIMIT 5
    `);
    if (examples.rows.length > 0) {
      console.log('\nSample pending non-recurring duels:');
      for (const r of examples.rows) {
        console.log(`  [${r.id}] ${r.title.slice(0, 60)}...`);
      }
    }

    const periodExamples = await pool.query(`
      SELECT dp.id as period_id, d.title, dp.slug as period_slug
      FROM duel_periods dp
      JOIN duels d ON dp.duel_id = d.id
      WHERE dp.on_chain_id IS NULL AND dp.status = 'active'
      LIMIT 5
    `);
    if (periodExamples.rows.length > 0) {
      console.log('\nSample pending recurring periods:');
      for (const r of periodExamples.rows) {
        console.log(`  [period ${r.period_id}] ${r.title.slice(0, 50)}... (${r.period_slug})`);
      }
    }
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
