/**
 * Notification service — creates notification rows with preference checking.
 *
 * Privacy: only uses data the server already has (comment authorship, duel creator, staker).
 * Never creates any user-duel voting associations.
 */

import { pool } from '../db/pool.js';

type NotificationType = 'comment_reply' | 'created_duel_ended' | 'stake_resolved';

const TYPE_TO_PREF_COLUMN: Record<NotificationType, string | null> = {
  comment_reply: 'comment_replies',
  created_duel_ended: 'created_duel_ended',
  stake_resolved: null, // always delivered (no user pref for this)
};

interface CreateNotificationParams {
  recipientAddress: string;
  type: NotificationType;
  duelId?: number;
  duelSlug?: string;
  duelTitle?: string;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Insert a notification, skipping if the user has disabled that type in preferences.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { recipientAddress, type, duelId, duelSlug, duelTitle, message, metadata } = params;

  const prefColumn = TYPE_TO_PREF_COLUMN[type];

  if (prefColumn) {
    // Single query: insert only if preference is not explicitly disabled
    await pool.query(
      `INSERT INTO notifications (recipient_address, type, duel_id, duel_slug, duel_title, message, metadata)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM notification_preferences
         WHERE address = $1 AND ${prefColumn} = FALSE
       )`,
      [recipientAddress, type, duelId ?? null, duelSlug ?? null, duelTitle ?? null, message, metadata ? JSON.stringify(metadata) : null],
    );
  } else {
    // No preference column — always insert
    await pool.query(
      `INSERT INTO notifications (recipient_address, type, duel_id, duel_slug, duel_title, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [recipientAddress, type, duelId ?? null, duelSlug ?? null, duelTitle ?? null, message, metadata ? JSON.stringify(metadata) : null],
    );
  }
}

/**
 * Create a notification for the duel creator when their duel ends.
 * Skips breaking-news-agent duels.
 */
export async function createDuelEndNotification(
  duelId: number,
  duelSlug: string,
  duelTitle: string,
  resultMessage: string,
  metadata?: Record<string, any>,
): Promise<void> {
  const result = await pool.query(
    `SELECT created_by FROM duels WHERE id = $1`,
    [duelId],
  );
  const createdBy = result.rows[0]?.created_by;
  if (!createdBy || createdBy === 'breaking-news-agent') return;

  await createNotification({
    recipientAddress: createdBy,
    type: 'created_duel_ended',
    duelId,
    duelSlug,
    duelTitle,
    message: resultMessage,
    metadata,
  });
}
