import pg from 'pg';

export const MIGRATION_V6_SQL = `
-- ============================================================
-- V6 Migration: Category-based navigation + multi duel types
-- Clean slate — drop old cloak-based tables, create new schema
-- ============================================================

-- Drop old pre-V6 cloak-based tables ONLY if they still exist.
-- Never drop comment_votes / comments — those are V6 tables we want to keep.
DROP TABLE IF EXISTS council_removal_votes CASCADE;
DROP TABLE IF EXISTS council_removals CASCADE;
DROP TABLE IF EXISTS council_invites CASCADE;
DROP TABLE IF EXISTS council_members CASCADE;
DROP TABLE IF EXISTS cloak_joins CASCADE;
DROP TABLE IF EXISTS duel_votes CASCADE;
DROP TABLE IF EXISTS vote_timeline CASCADE;
DROP TABLE IF EXISTS duel_snapshots CASCADE;
DROP TABLE IF EXISTS duel_schedule CASCADE;
DROP TABLE IF EXISTS statements CASCADE;
DROP TABLE IF EXISTS banned_members CASCADE;
DROP TABLE IF EXISTS whisper_events CASCADE;
DROP TABLE IF EXISTS whispers CASCADE;
DROP TABLE IF EXISTS duel_stars CASCADE;
DROP TABLE IF EXISTS keeper_cloaks CASCADE;

-- 8 fixed categories, seeded below
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

-- User-created subcategories within a category
CREATE TABLE IF NOT EXISTS subcategories (
  id SERIAL PRIMARY KEY,
  category_id INT REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories (category_id);

-- Unified duel table for all 3 types
CREATE TABLE IF NOT EXISTS duels (
  id SERIAL PRIMARY KEY,
  on_chain_id INT,
  subcategory_id INT REFERENCES subcategories(id),
  title TEXT NOT NULL,
  description TEXT,
  duel_type TEXT NOT NULL CHECK (duel_type IN ('binary', 'multi', 'level')),
  timing_type TEXT NOT NULL CHECK (timing_type IN ('end_time', 'duration', 'recurring')),
  ends_at TIMESTAMPTZ,
  duration_seconds INT,
  recurrence TEXT CHECK (recurrence IN ('weekly', 'monthly', 'yearly')),
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  agree_count INT DEFAULT 0,
  disagree_count INT DEFAULT 0,
  total_votes INT DEFAULT 0,
  comment_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_duels_subcategory ON duels (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_duels_status ON duels (status);
CREATE INDEX IF NOT EXISTS idx_duels_type ON duels (duel_type);
CREATE INDEX IF NOT EXISTS idx_duels_created ON duels (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_duels_onchain ON duels (on_chain_id) WHERE on_chain_id IS NOT NULL;

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_duels_search ON duels USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Options for multi-item duels (user can add up to 50)
CREATE TABLE IF NOT EXISTS duel_options (
  id SERIAL PRIMARY KEY,
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  vote_count INT DEFAULT 0,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_duel_options_duel ON duel_options (duel_id);

-- Level vote aggregates (10 levels per duel)
CREATE TABLE IF NOT EXISTS duel_levels (
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  level INT CHECK (level BETWEEN 1 AND 10),
  vote_count INT DEFAULT 0,
  PRIMARY KEY (duel_id, level)
);

-- Recurring duel periods
CREATE TABLE IF NOT EXISTS duel_periods (
  id SERIAL PRIMARY KEY,
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  on_chain_id INT,
  agree_count INT DEFAULT 0,
  disagree_count INT DEFAULT 0,
  total_votes INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_duel_periods_duel ON duel_periods (duel_id);

-- Vote snapshots for time-filtered charts
CREATE TABLE IF NOT EXISTS vote_snapshots (
  id SERIAL PRIMARY KEY,
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  period_id INT REFERENCES duel_periods(id),
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  agree_count INT DEFAULT 0,
  disagree_count INT DEFAULT 0,
  total_votes INT DEFAULT 0,
  option_counts JSONB
);

CREATE INDEX IF NOT EXISTS idx_vote_snapshots_duel ON vote_snapshots (duel_id, snapshot_at DESC);

-- Comments (fresh table, no cloak references)
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  duel_id INT REFERENCES duels(id) ON DELETE CASCADE,
  parent_id INT REFERENCES comments(id),
  author_address TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  upvotes INT DEFAULT 0,
  downvotes INT DEFAULT 0,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_duel ON comments (duel_id);

-- Comment votes
CREATE TABLE IF NOT EXISTS comment_votes (
  id SERIAL PRIMARY KEY,
  comment_id INT REFERENCES comments(id) ON DELETE CASCADE,
  voter_address TEXT NOT NULL,
  direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, voter_address)
);

-- Trigger to update comment vote counts
CREATE OR REPLACE FUNCTION update_comment_votes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 1 THEN
      UPDATE comments SET upvotes = upvotes + 1 WHERE id = NEW.comment_id;
    ELSE
      UPDATE comments SET downvotes = downvotes + 1 WHERE id = NEW.comment_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.direction = 1 THEN
      UPDATE comments SET upvotes = GREATEST(upvotes - 1, 0) WHERE id = OLD.comment_id;
    ELSE
      UPDATE comments SET downvotes = GREATEST(downvotes - 1, 0) WHERE id = OLD.comment_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.direction = 1 THEN
      UPDATE comments SET upvotes = GREATEST(upvotes - 1, 0) WHERE id = OLD.comment_id;
    ELSE
      UPDATE comments SET downvotes = GREATEST(downvotes - 1, 0) WHERE id = OLD.comment_id;
    END IF;
    IF NEW.direction = 1 THEN
      UPDATE comments SET upvotes = upvotes + 1 WHERE id = NEW.comment_id;
    ELSE
      UPDATE comments SET downvotes = downvotes + 1 WHERE id = NEW.comment_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_votes ON comment_votes;
CREATE TRIGGER trg_comment_votes
  AFTER INSERT OR DELETE OR UPDATE ON comment_votes
  FOR EACH ROW EXECUTE FUNCTION update_comment_votes();

-- Trigger to update duel comment_count
CREATE OR REPLACE FUNCTION update_duel_comment_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE duels SET comment_count = comment_count + 1 WHERE id = NEW.duel_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE duels SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.duel_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_duel_comment_count ON comments;
CREATE TRIGGER trg_duel_comment_count
  AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION update_duel_comment_count();

-- Seed 8 categories
INSERT INTO categories (name, slug, sort_order) VALUES
  ('Politics', 'politics', 1),
  ('Geopolitics', 'geopolitics', 2),
  ('Tech & AI', 'tech-ai', 3),
  ('Culture', 'culture', 4),
  ('World', 'world', 5),
  ('Economy', 'economy', 6),
  ('Climate & Science', 'climate-science', 7),
  ('Elections', 'elections', 8)
ON CONFLICT (slug) DO NOTHING;

-- Seed subcategories
-- Politics
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='politics'), 'Trump', 'trump'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Epstein', 'epstein'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Elections', 'elections'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Money in Politics', 'money-in-politics'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Organizing', 'organizing'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Issues', 'issues'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Borders', 'borders'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Immigration', 'immigration'),
  ((SELECT id FROM categories WHERE slug='politics'), 'Congress', 'congress')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Geopolitics
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Iran', 'iran'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Oil', 'oil'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Ukraine', 'ukraine'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Gaza', 'gaza'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Israel', 'israel'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Sudan', 'sudan'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'China', 'china'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Middle East', 'middle-east'),
  ((SELECT id FROM categories WHERE slug='geopolitics'), 'Foreign Policy', 'foreign-policy')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Tech & AI
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'AI', 'ai'),
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'Science', 'science'),
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'Startups', 'startups'),
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'Big Tech', 'big-tech'),
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'Surveillance', 'surveillance'),
  ((SELECT id FROM categories WHERE slug='tech-ai'), 'Labor', 'labor')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Culture
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='culture'), 'Music', 'music'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Movies', 'movies'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Celebrities', 'celebrities'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Awards', 'awards'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Identity', 'identity'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Quality of Life', 'quality-of-life'),
  ((SELECT id FROM categories WHERE slug='culture'), 'Values', 'values')
ON CONFLICT (category_id, slug) DO NOTHING;

-- World
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='world'), 'Global Elections', 'global-elections'),
  ((SELECT id FROM categories WHERE slug='world'), 'China', 'china'),
  ((SELECT id FROM categories WHERE slug='world'), 'Gaza', 'gaza'),
  ((SELECT id FROM categories WHERE slug='world'), 'Iran', 'iran'),
  ((SELECT id FROM categories WHERE slug='world'), 'Venezuela', 'venezuela'),
  ((SELECT id FROM categories WHERE slug='world'), 'Middle East', 'middle-east')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Economy
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='economy'), 'Trade War', 'trade-war'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Inflation', 'inflation'),
  ((SELECT id FROM categories WHERE slug='economy'), 'GDP', 'gdp'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Taxes', 'taxes'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Housing', 'housing'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Cost of Living', 'cost-of-living'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Wages', 'wages'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Capitalism/Socialism', 'capitalism-socialism'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Distribution', 'distribution'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Billionaires', 'billionaires'),
  ((SELECT id FROM categories WHERE slug='economy'), 'Labor', 'labor')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Climate & Science
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Weather', 'weather'),
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Climate Change Causes', 'climate-change-causes'),
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Space', 'space'),
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Natural Disasters', 'natural-disasters'),
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Prep', 'prep'),
  ((SELECT id FROM categories WHERE slug='climate-science'), 'Solutions', 'solutions')
ON CONFLICT (category_id, slug) DO NOTHING;

-- Elections
INSERT INTO subcategories (category_id, name, slug) VALUES
  ((SELECT id FROM categories WHERE slug='elections'), 'US President', 'us-president'),
  ((SELECT id FROM categories WHERE slug='elections'), 'US Senate', 'us-senate'),
  ((SELECT id FROM categories WHERE slug='elections'), 'US House', 'us-house'),
  ((SELECT id FROM categories WHERE slug='elections'), 'International', 'international'),
  ((SELECT id FROM categories WHERE slug='elections'), 'Primaries', 'primaries')
ON CONFLICT (category_id, slug) DO NOTHING;
`;

/** Run V6 migration using any pg.Pool. */
export async function runMigrateV6(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v6] Running V6 migration (category restructure)...');
  await externalPool.query(MIGRATION_V6_SQL);

  // Post-V6 addendum: level duel labels + chart display + custom level count
  await externalPool.query(`
    ALTER TABLE duels ADD COLUMN IF NOT EXISTS level_low_label TEXT;
    ALTER TABLE duels ADD COLUMN IF NOT EXISTS level_high_label TEXT;
    ALTER TABLE duels ADD COLUMN IF NOT EXISTS chart_mode TEXT DEFAULT 'top_n';
    ALTER TABLE duels ADD COLUMN IF NOT EXISTS chart_top_n INT DEFAULT 5;
    ALTER TABLE duel_levels ADD COLUMN IF NOT EXISTS label TEXT;
    ALTER TABLE duel_levels DROP CONSTRAINT IF EXISTS duel_levels_level_check;
    ALTER TABLE duel_levels ADD CONSTRAINT duel_levels_level_check CHECK (level BETWEEN 1 AND 10);
    ALTER TABLE duels ADD COLUMN IF NOT EXISTS end_block INT;
  `);

  console.log('[migrate_v6] Done.');
}
