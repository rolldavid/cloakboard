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

export const MIGRATION_V2_SQL = `
-- ============================================================
-- V2 Migration: Social layer tables
-- ============================================================

-- 1. Comments
CREATE TABLE IF NOT EXISTS comments (
  id              BIGSERIAL PRIMARY KEY,
  duel_id         INTEGER NOT NULL,
  cloak_address   VARCHAR(66) NOT NULL,
  parent_id       BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  author_address  VARCHAR(66) NOT NULL,
  author_name     VARCHAR(31) NOT NULL,
  body            TEXT NOT NULL,
  upvotes         INTEGER NOT NULL DEFAULT 0,
  downvotes       INTEGER NOT NULL DEFAULT 0,
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_duel ON comments (cloak_address, duel_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments (author_address);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at);

-- 2. Comment Votes + Trigger
CREATE TABLE IF NOT EXISTS comment_votes (
  comment_id     BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  voter_address  VARCHAR(66) NOT NULL,
  direction      SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, voter_address)
);

CREATE INDEX IF NOT EXISTS idx_comment_votes_voter ON comment_votes (voter_address);

CREATE OR REPLACE FUNCTION update_comment_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 1 THEN
      UPDATE comments SET upvotes = upvotes + 1, updated_at = NOW() WHERE id = NEW.comment_id;
    ELSE
      UPDATE comments SET downvotes = downvotes + 1, updated_at = NOW() WHERE id = NEW.comment_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.direction = 1 THEN
      UPDATE comments SET upvotes = GREATEST(upvotes - 1, 0), updated_at = NOW() WHERE id = OLD.comment_id;
    ELSE
      UPDATE comments SET downvotes = GREATEST(downvotes - 1, 0), updated_at = NOW() WHERE id = OLD.comment_id;
    END IF;
    IF NEW.direction = 1 THEN
      UPDATE comments SET upvotes = upvotes + 1, updated_at = NOW() WHERE id = NEW.comment_id;
    ELSE
      UPDATE comments SET downvotes = downvotes + 1, updated_at = NOW() WHERE id = NEW.comment_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.direction = 1 THEN
      UPDATE comments SET upvotes = GREATEST(upvotes - 1, 0), updated_at = NOW() WHERE id = OLD.comment_id;
    ELSE
      UPDATE comments SET downvotes = GREATEST(downvotes - 1, 0), updated_at = NOW() WHERE id = OLD.comment_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_votes ON comment_votes;
CREATE TRIGGER trg_comment_votes
  AFTER INSERT OR UPDATE OR DELETE ON comment_votes
  FOR EACH ROW EXECUTE FUNCTION update_comment_vote_counts();

-- 3. Duel Stars
CREATE TABLE IF NOT EXISTS duel_stars (
  cloak_address  VARCHAR(66) NOT NULL,
  duel_id        INTEGER NOT NULL,
  user_address   VARCHAR(66) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cloak_address, duel_id, user_address)
);

CREATE INDEX IF NOT EXISTS idx_duel_stars_user ON duel_stars (user_address);
CREATE INDEX IF NOT EXISTS idx_duel_stars_count ON duel_stars (cloak_address, duel_id);

-- 4. Banned Members
CREATE TABLE IF NOT EXISTS banned_members (
  cloak_address  VARCHAR(66) NOT NULL,
  user_address   VARCHAR(66) NOT NULL,
  user_name      VARCHAR(31),
  banned_by      VARCHAR(66) NOT NULL,
  banned_by_name VARCHAR(31),
  reason         TEXT,
  banned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cloak_address, user_address)
);

-- 5. Council Members
CREATE TABLE IF NOT EXISTS council_members (
  cloak_address  VARCHAR(66) NOT NULL,
  user_address   VARCHAR(66) NOT NULL,
  username       VARCHAR(31),
  role           INTEGER NOT NULL DEFAULT 2,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cloak_address, user_address)
);

CREATE INDEX IF NOT EXISTS idx_council_members_cloak ON council_members (cloak_address);

-- 6. Whisper Points
CREATE TABLE IF NOT EXISTS whispers (
  user_address   VARCHAR(66) PRIMARY KEY,
  total_points   INTEGER NOT NULL DEFAULT 0,
  duel_votes     INTEGER NOT NULL DEFAULT 0,
  comments       INTEGER NOT NULL DEFAULT 0,
  comment_votes  INTEGER NOT NULL DEFAULT 0,
  stars          INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whisper_events (
  id              BIGSERIAL PRIMARY KEY,
  user_address    VARCHAR(66) NOT NULL,
  action          VARCHAR(20) NOT NULL,
  points          INTEGER NOT NULL,
  reference_id    VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whisper_events_user ON whisper_events (user_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whisper_events_dedup ON whisper_events (user_address, action, reference_id);

-- 7. Vote Timeline Snapshots (for line chart)
CREATE TABLE IF NOT EXISTS vote_timeline (
  id              BIGSERIAL PRIMARY KEY,
  cloak_address   VARCHAR(66) NOT NULL,
  duel_id         INTEGER NOT NULL,
  agree_pct       REAL NOT NULL DEFAULT 50.0,
  agree_votes     INTEGER NOT NULL DEFAULT 0,
  disagree_votes  INTEGER NOT NULL DEFAULT 0,
  total_votes     INTEGER NOT NULL DEFAULT 0,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vote_timeline_lookup
  ON vote_timeline (cloak_address, duel_id, snapshot_at);

-- Prevent duplicate snapshots at the same second
CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_timeline_dedup
  ON vote_timeline (cloak_address, duel_id, snapshot_at);
`;

/** Run V2 migration using any pg.Pool. Safe to call multiple times (IF NOT EXISTS). */
export async function runMigrateV2(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v2] Running V2 migrations...');
  await externalPool.query(MIGRATION_V2_SQL);
  console.log('[migrate_v2] Done.');
}

// --- CLI entry point (npx tsx src/lib/db/migrate_v2.ts) ---
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateV2() {
  try {
    await runMigrateV2(pool);
  } catch (err: any) {
    console.error('[migrate_v2] Error:', err?.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only run when executed directly (not when imported)
const isDirectRun = process.argv[1]?.includes('migrate_v2');
if (isDirectRun) migrateV2();
