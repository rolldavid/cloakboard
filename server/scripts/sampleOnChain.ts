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

  const r = await pool.query(`
    SELECT id, title, slug, on_chain_id, duel_type, timing_type
    FROM duels WHERE on_chain_id IS NOT NULL
    ORDER BY id LIMIT 3
  `);
  for (const row of r.rows) {
    console.log(`[${row.duel_type}] "${row.title}"`);
    console.log(`  slug: ${row.slug}`);
    console.log(`  on_chain_id: ${row.on_chain_id}`);
    console.log(`  timing: ${row.timing_type}\n`);
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
