/**
 * Reset all on_chain_id values to NULL so the cron re-creates duels on the new contract.
 * Run: cd server && npx tsx scripts/resetOnChainIds.ts
 */

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

  // Reset non-recurring duels
  const duels = await pool.query(
    `UPDATE duels SET on_chain_id = NULL, end_block = NULL WHERE on_chain_id IS NOT NULL RETURNING id`,
  );
  console.log(`Reset ${duels.rowCount} duels on_chain_id to NULL`);

  // Reset recurring periods
  const periods = await pool.query(
    `UPDATE duel_periods SET on_chain_id = NULL, end_block = NULL WHERE on_chain_id IS NOT NULL RETURNING id`,
  );
  console.log(`Reset ${periods.rowCount} duel_periods on_chain_id to NULL`);

  // Verify
  const pendingDuels = await pool.query(`SELECT count(*) FROM duels WHERE on_chain_id IS NULL AND timing_type != 'recurring'`);
  const pendingPeriods = await pool.query(`SELECT count(*) FROM duel_periods WHERE on_chain_id IS NULL AND status = 'active'`);
  console.log(`\nPending for cron: ${pendingDuels.rows[0].count} duels, ${pendingPeriods.rows[0].count} periods`);

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
