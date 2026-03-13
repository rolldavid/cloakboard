/**
 * V18 Migration — Notification system
 *
 * Adds notification preferences and notification inbox tables.
 * No duel_watchers table — vote participation is never leaked to the server.
 */

import type { Pool } from 'pg';

const MIGRATION_V18_SQL = `
-- User notification preferences (opt-out granularity)
CREATE TABLE IF NOT EXISTS notification_preferences (
  address TEXT PRIMARY KEY,
  comment_replies BOOLEAN DEFAULT TRUE,
  created_duel_ended BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification inbox
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  recipient_address TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('comment_reply','created_duel_ended','stake_resolved')),
  duel_id INT REFERENCES duels(id),
  duel_slug TEXT,
  duel_title TEXT,
  message TEXT NOT NULL,
  metadata JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_address, is_read, created_at DESC);
`;

export async function runMigrateV18(pool: Pool): Promise<void> {
  try {
    await pool.query(MIGRATION_V18_SQL);
    console.log('[migrate_v18] Notification schema applied');
  } catch (err: any) {
    if (err?.message?.includes('already exists')) {
      console.log('[migrate_v18] Already applied');
    } else {
      console.warn('[migrate_v18] Warning:', err?.message);
    }
  }
}
