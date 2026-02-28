/**
 * Tracks which social actions have already been awarded on-chain points,
 * preventing duplicate IVC proofs when users toggle votes.
 *
 * Key format examples:
 *   "comment:123"
 *   "comment_vote:456"
 *   "duel_vote:0xabc:7"
 */

const STORAGE_KEY = 'duelcloak_points_awarded';

function getAwardedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveAwardedSet(set: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch { /* localStorage full or unavailable */ }
}

export function hasPointsBeenAwarded(key: string): boolean {
  return getAwardedSet().has(key);
}

export function markPointsAwarded(key: string): void {
  const set = getAwardedSet();
  set.add(key);
  saveAwardedSet(set);
}
