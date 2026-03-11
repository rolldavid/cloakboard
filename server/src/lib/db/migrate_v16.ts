import pg from 'pg';

/**
 * V16 Migration: Add breaking_image_url to duels for article thumbnail display.
 */
export const MIGRATION_V16_SQL = `
-- ============================================================
-- V16 Migration: Breaking news image URL
-- ============================================================

ALTER TABLE duels ADD COLUMN IF NOT EXISTS breaking_image_url TEXT;
`;

/** Run V16 migration using any pg.Pool. */
export async function runMigrateV16(pool: pg.Pool): Promise<void> {
  console.log('[migrate_v16] Running V16 migration (breaking news image URL)...');
  await pool.query(MIGRATION_V16_SQL);
  console.log('[migrate_v16] Done.');
}
