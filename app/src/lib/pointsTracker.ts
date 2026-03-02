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

// ===== Optimistic point accumulator =====
// Tracks cumulative points in localStorage so the sidebar can display instantly
// without waiting for PXE wallet init + on-chain note decryption.

const POINTS_TOTAL_KEY = 'duelcloak_points_total';
const AWARDS_SINCE_CONSOLIDATION_KEY = 'duelcloak_awards_since_consolidation';

/** Get the optimistic cumulative point total. */
export function getOptimisticPoints(): number {
  try {
    return parseInt(localStorage.getItem(POINTS_TOTAL_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

/** Add points to the optimistic total and increment the award counter. */
export function addOptimisticPoints(amount: number): void {
  try {
    const current = getOptimisticPoints();
    localStorage.setItem(POINTS_TOTAL_KEY, String(current + amount));
    // Increment actual stored counter (not the sentinel 99 from getAwardsSinceConsolidation)
    const raw = localStorage.getItem(AWARDS_SINCE_CONSOLIDATION_KEY);
    const awards = raw !== null ? (parseInt(raw, 10) || 0) : 0;
    localStorage.setItem(AWARDS_SINCE_CONSOLIDATION_KEY, String(awards + 1));
  } catch { /* localStorage full or unavailable */ }
}

/** Get the number of point awards since the last consolidation.
 *  Returns 99 if no consolidation has ever happened (forces initial consolidation). */
export function getAwardsSinceConsolidation(): number {
  try {
    const raw = localStorage.getItem(AWARDS_SINCE_CONSOLIDATION_KEY);
    if (raw === null) return 99; // Never consolidated — force initial consolidation
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

/** Reset the award counter after a consolidation tx. */
export function resetAwardsSinceConsolidation(): void {
  try {
    localStorage.setItem(AWARDS_SINCE_CONSOLIDATION_KEY, '0');
  } catch { /* ignore */ }
}

/** Clear all points state. Call on logout / account switch. */
export function resetPointsTracker(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(POINTS_TOTAL_KEY);
    localStorage.removeItem(AWARDS_SINCE_CONSOLIDATION_KEY);
  } catch { /* ignore */ }
}

/** Sync optimistic total with an on-chain reading (use the higher value). */
export function syncOptimisticPoints(onChainPoints: number): void {
  try {
    const current = getOptimisticPoints();
    // Use the higher value — on-chain may lag behind optimistic (unmined txs),
    // but if on-chain is higher (e.g., different device), adopt that.
    localStorage.setItem(POINTS_TOTAL_KEY, String(Math.max(current, onChainPoints)));
  } catch { /* ignore */ }
}
