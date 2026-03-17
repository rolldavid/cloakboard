/**
 * V22 Migration — OG image URL stored per duel for social sharing.
 * Generated on vote sync and uploaded to R2.
 */

import type { Pool } from 'pg';

const MIGRATION_V22_SQL = `
ALTER TABLE duels ADD COLUMN IF NOT EXISTS og_image_url TEXT;
`;

export async function runMigrateV22(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V22_SQL);
    console.log('[migrate_v22] og_image_url column applied');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v22] Already applied');
    } else {
      console.warn('[migrate_v22] Warning:', err?.message);
    }
  }
}
