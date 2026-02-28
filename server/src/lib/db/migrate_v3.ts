import dotenv from 'dotenv';
import pg from 'pg';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(__filename), '../../../');

dotenv.config({ path: resolve(serverRoot, '.env.local') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: resolve(serverRoot, '.env') });
}

export const MIGRATION_V3_SQL = `
-- ============================================================
-- V3 Migration: Duel quality votes
-- ============================================================

-- 1. Duel quality votes (upvote/downvote on duel quality)
CREATE TABLE IF NOT EXISTS duel_votes (
  cloak_address  VARCHAR(66) NOT NULL,
  duel_id        INTEGER NOT NULL,
  voter_address  VARCHAR(66) NOT NULL,
  direction      SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cloak_address, duel_id, voter_address)
);

CREATE INDEX IF NOT EXISTS idx_duel_votes_voter ON duel_votes (voter_address);
CREATE INDEX IF NOT EXISTS idx_duel_votes_count ON duel_votes (cloak_address, duel_id);

-- 2. Quality vote counts on duel_snapshots
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'duel_snapshots' AND column_name = 'quality_upvotes') THEN
    ALTER TABLE duel_snapshots ADD COLUMN quality_upvotes INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'duel_snapshots' AND column_name = 'quality_downvotes') THEN
    ALTER TABLE duel_snapshots ADD COLUMN quality_downvotes INTEGER DEFAULT 0;
  END IF;
END $$;

-- 3. Add duel_quality_votes column to whispers table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whispers' AND column_name = 'duel_quality_votes') THEN
    ALTER TABLE whispers ADD COLUMN duel_quality_votes INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 4. Trigger to sync duel_votes -> duel_snapshots quality counts
CREATE OR REPLACE FUNCTION update_duel_quality_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 1 THEN
      UPDATE duel_snapshots SET quality_upvotes = quality_upvotes + 1 WHERE cloak_address = NEW.cloak_address AND duel_id = NEW.duel_id;
    ELSE
      UPDATE duel_snapshots SET quality_downvotes = quality_downvotes + 1 WHERE cloak_address = NEW.cloak_address AND duel_id = NEW.duel_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.direction = 1 THEN
      UPDATE duel_snapshots SET quality_upvotes = GREATEST(quality_upvotes - 1, 0) WHERE cloak_address = OLD.cloak_address AND duel_id = OLD.duel_id;
    ELSE
      UPDATE duel_snapshots SET quality_downvotes = GREATEST(quality_downvotes - 1, 0) WHERE cloak_address = OLD.cloak_address AND duel_id = OLD.duel_id;
    END IF;
    IF NEW.direction = 1 THEN
      UPDATE duel_snapshots SET quality_upvotes = quality_upvotes + 1 WHERE cloak_address = NEW.cloak_address AND duel_id = NEW.duel_id;
    ELSE
      UPDATE duel_snapshots SET quality_downvotes = quality_downvotes + 1 WHERE cloak_address = NEW.cloak_address AND duel_id = NEW.duel_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.direction = 1 THEN
      UPDATE duel_snapshots SET quality_upvotes = GREATEST(quality_upvotes - 1, 0) WHERE cloak_address = OLD.cloak_address AND duel_id = OLD.duel_id;
    ELSE
      UPDATE duel_snapshots SET quality_downvotes = GREATEST(quality_downvotes - 1, 0) WHERE cloak_address = OLD.cloak_address AND duel_id = OLD.duel_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_duel_votes ON duel_votes;
CREATE TRIGGER trg_duel_votes
  AFTER INSERT OR UPDATE OR DELETE ON duel_votes
  FOR EACH ROW EXECUTE FUNCTION update_duel_quality_vote_counts();

-- 5. Cloak joins (replaces duel-level stars with cloak-level joins)
CREATE TABLE IF NOT EXISTS cloak_joins (
  cloak_address  VARCHAR(66) NOT NULL,
  user_address   VARCHAR(66) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cloak_address, user_address)
);
CREATE INDEX IF NOT EXISTS idx_cloak_joins_user ON cloak_joins (user_address);
`;

/** Run V3 migration using any pg.Pool. Safe to call multiple times (IF NOT EXISTS). */
export async function runMigrateV3(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v3] Running V3 migrations...');
  await externalPool.query(MIGRATION_V3_SQL);
  console.log('[migrate_v3] Done.');
}

// --- CLI entry point (npx tsx src/lib/db/migrate_v3.ts) ---
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateV3() {
  try {
    await runMigrateV3(pool);
  } catch (err: any) {
    console.error('[migrate_v3] Error:', err?.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run when executed directly (not when imported)
const isDirectRun = process.argv[1]?.includes('migrate_v3');
if (isDirectRun) migrateV3();
