import pg from 'pg';

export const MIGRATION_V8_SQL = `
-- ============================================================
-- V8 Migration: URL-safe slugs for duels
-- ============================================================

-- Add slug column to duels (unique, URL-safe hyphenated title)
ALTER TABLE duels ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_duels_slug ON duels (slug) WHERE slug IS NOT NULL;

-- Backfill existing duels with slug = id (so old URLs still work via fallback)
UPDATE duels SET slug = id::text WHERE slug IS NULL;
`;

/** Run V8 migration using any pg.Pool. */
export async function runMigrateV8(externalPool: pg.Pool): Promise<void> {
  console.log('[migrate_v8] Running V8 migration (duel slugs)...');
  await externalPool.query(MIGRATION_V8_SQL);
  console.log('[migrate_v8] Done.');
}
