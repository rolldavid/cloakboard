import { pool } from './pool.js';

const POINT_VALUES: Record<string, number> = {
  duel_vote: 10,
  comment: 1,
  comment_vote: 1,
  star: 1,
  duel_quality_vote: 1,
};

const COLUMN_MAP: Record<string, string> = {
  duel_vote: 'duel_votes',
  comment: 'comments',
  comment_vote: 'comment_votes',
  star: 'stars',
  duel_quality_vote: 'duel_quality_votes',
};

export const WHISPER_LEVELS = [
  { level: 1, name: 'Listener', minPoints: 0 },
  { level: 2, name: 'Whisperer', minPoints: 50 },
  { level: 3, name: 'Voice', minPoints: 200 },
  { level: 4, name: 'Speaker', minPoints: 500 },
  { level: 5, name: 'Orator', minPoints: 1000 },
  { level: 6, name: 'Herald', minPoints: 2500 },
  { level: 7, name: 'Oracle', minPoints: 5000 },
] as const;

export function getWhisperLevel(totalPoints: number) {
  for (let i = WHISPER_LEVELS.length - 1; i >= 0; i--) {
    if (totalPoints >= WHISPER_LEVELS[i].minPoints) {
      return WHISPER_LEVELS[i];
    }
  }
  return WHISPER_LEVELS[0];
}

export function getNextLevel(totalPoints: number) {
  const current = getWhisperLevel(totalPoints);
  const next = WHISPER_LEVELS.find((l) => l.minPoints > totalPoints);
  return next ?? null;
}

/**
 * Award whisper points for an action. Deduplicates by (user, action, referenceId).
 * Returns the points awarded, or null if already awarded (dedup).
 */
export async function awardWhisperPoints(
  userAddress: string,
  action: 'duel_vote' | 'comment' | 'comment_vote' | 'star' | 'duel_quality_vote',
  referenceId: string,
): Promise<number | null> {
  const points = POINT_VALUES[action];
  if (!points) return null;

  const column = COLUMN_MAP[action];

  // MEDIUM-2: Explicit allowlist validation for dynamic column names
  const allowedColumns = ['duel_votes', 'comments', 'comment_votes', 'stars', 'duel_quality_votes'];
  if (!column || !allowedColumns.includes(column)) {
    throw new Error('Invalid action');
  }

  // Try insert into whisper_events (dedup index prevents duplicates)
  const eventResult = await pool.query(
    `INSERT INTO whisper_events (user_address, action, points, reference_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_address, action, reference_id) DO NOTHING
     RETURNING id`,
    [userAddress, action, points, referenceId],
  );

  // If no row returned, this was a duplicate
  if (eventResult.rowCount === 0) return null;

  // Upsert whispers summary
  await pool.query(
    `INSERT INTO whispers (user_address, total_points, ${column})
     VALUES ($1, $2, 1)
     ON CONFLICT (user_address) DO UPDATE SET
       total_points = whispers.total_points + $2,
       ${column} = whispers.${column} + 1,
       updated_at = NOW()`,
    [userAddress, points],
  );

  return points;
}

/**
 * Get whisper stats for a user.
 */
export async function getWhisperStats(userAddress: string) {
  const result = await pool.query(
    `SELECT total_points, duel_votes, comments, comment_votes, stars, COALESCE(duel_quality_votes, 0) AS duel_quality_votes
     FROM whispers WHERE user_address = $1`,
    [userAddress],
  );
  if (result.rows.length === 0) {
    return { totalPoints: 0, duelVotes: 0, comments: 0, commentVotes: 0, stars: 0, duelQualityVotes: 0 };
  }
  const row = result.rows[0];
  return {
    totalPoints: row.total_points,
    duelVotes: row.duel_votes,
    comments: row.comments,
    commentVotes: row.comment_votes,
    stars: row.stars,
    duelQualityVotes: row.duel_quality_votes ?? 0,
  };
}
