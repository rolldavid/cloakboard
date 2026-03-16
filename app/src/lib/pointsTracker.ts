/**
 * Per-account optimistic points tracker.
 *
 * All localStorage keys are namespaced by shortAddr so multiple accounts
 * on the same device don't collide. Call setActiveAccount(shortAddr) on
 * login/rehydrate before reading any values.
 *
 * Key format: dc_pts_{shortAddr}_{suffix}
 */

// ===== Active account =====

let _activeAddr: string | null = null;

/** Switch the tracker to a specific account. Call on login + store rehydrate. */
export function setActiveAccount(shortAddr: string): void {
  _activeAddr = shortAddr;
}

function acctKey(suffix: string): string {
  if (!_activeAddr) return `dc_pts_none_${suffix}`;
  return `dc_pts_${_activeAddr}_${suffix}`;
}

// ===== Awarded actions (duplicate-prevention) =====

function getAwardedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(acctKey('awarded'));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveAwardedSet(set: Set<string>): void {
  try {
    localStorage.setItem(acctKey('awarded'), JSON.stringify([...set]));
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

/** Get the optimistic cumulative point total. */
export function getOptimisticPoints(): number {
  try {
    return parseInt(localStorage.getItem(acctKey('total')) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

/** Add points to the optimistic total (fires listeners for reactive UI). */
export function addOptimisticPoints(amount: number): void {
  try {
    const current = getOptimisticPoints();
    localStorage.setItem(acctKey('total'), String(current + amount));
  } catch { /* localStorage full or unavailable */ }
  // Set a grace period so on-chain sync doesn't overwrite for 5 minutes
  try {
    localStorage.setItem(acctKey('grace'), String(Date.now() + 5 * 60 * 1000));
  } catch { /* ignore */ }
  // Notify listeners (used by store to trigger reactive UI updates)
  _listeners.forEach((fn) => fn(amount));
}

/**
 * Set optimistic points to an exact value WITHOUT firing store listeners.
 * Used for display hints (e.g. 500pt new-user hint) that shouldn't double-count.
 * Does NOT set a grace period — on-chain sync can freely replace this value.
 */
export function setOptimisticPointsQuiet(value: number): void {
  try {
    localStorage.setItem(acctKey('total'), String(value));
  } catch { /* ignore */ }
}

// Listener for reactive store integration (avoids circular dependency)
type PointsListener = (amount: number) => void;
const _listeners = new Set<PointsListener>();
export function onPointsAdded(fn: PointsListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// Listener for on-chain sync events (total replacement, not additive)
type PointsSyncListener = (total: number) => void;
const _syncListeners = new Set<PointsSyncListener>();
export function onPointsSynced(fn: PointsSyncListener): () => void {
  _syncListeners.add(fn);
  return () => { _syncListeners.delete(fn); };
}

// ===== Initial grant tracking =====

/** Check if the 500pt initial grant has been sent for this account. */
export function isInitialGrantSent(): boolean {
  try {
    return localStorage.getItem(acctKey('grant_sent')) === '1';
  } catch {
    return false;
  }
}

/** Mark that the initial grant tx was successfully sent. */
export function markInitialGrantSent(): void {
  try {
    localStorage.setItem(acctKey('grant_sent'), '1');
  } catch { /* ignore */ }
}

// ===== Consolidation tracking =====

/** Get the number of point awards since the last consolidation.
 *  Returns 99 if no consolidation has ever happened (forces initial consolidation). */
export function getAwardsSinceConsolidation(): number {
  try {
    const raw = localStorage.getItem(acctKey('awards_since'));
    if (raw === null) return 99;
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

/** Reset the award counter after a consolidation tx. */
export function resetAwardsSinceConsolidation(): void {
  try {
    localStorage.setItem(acctKey('awards_since'), '0');
  } catch { /* ignore */ }
}

// ===== Reset =====

/** Clear all points state for the current account. Call on logout / account switch. */
export function resetPointsTracker(): void {
  if (!_activeAddr) return;
  try {
    localStorage.removeItem(acctKey('awarded'));
    localStorage.removeItem(acctKey('total'));
    localStorage.removeItem(acctKey('awards_since'));
    localStorage.removeItem(acctKey('grant_sent'));
    localStorage.removeItem(acctKey('grace'));
    localStorage.removeItem(acctKey('certified'));
    localStorage.removeItem(acctKey('vote_stakes'));
  } catch { /* ignore */ }
}

// ===== On-chain sync =====

/** Sync optimistic total with an on-chain reading. */
export function syncOptimisticPoints(onChainPoints: number): void {
  try {
    const current = getOptimisticPoints();

    // Always protect: if on-chain is 0 but optimistic has value, keep optimistic.
    // This covers new users with the 500pt display hint before grant mines.
    if (onChainPoints === 0 && current > 0) {
      return;
    }

    // During grace (from vote deductions), keep optimistic if values differ
    const graceUntil = parseInt(localStorage.getItem(acctKey('grace')) || '0', 10) || 0;
    if (Date.now() < graceUntil && onChainPoints !== current) {
      return;
    }
    if (Date.now() >= graceUntil) {
      localStorage.removeItem(acctKey('grace'));
    }

    localStorage.setItem(acctKey('total'), String(onChainPoints));
    // Notify store so UI reacts to on-chain sync
    _syncListeners.forEach((fn) => fn(onChainPoints));
  } catch { /* ignore */ }
}

// ===== Vote stake cache (for Positions page + vote direction recovery) =====

export interface CachedVoteStake {
  duelId: number;
  dbDuelId?: number;
  direction: number;
  stakeAmount: number;
  slug?: string;
  title?: string;
}

/** Get cached vote stakes for this account. */
export function getCachedVoteStakes(): CachedVoteStake[] {
  try {
    const raw = localStorage.getItem(acctKey('vote_stakes'));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Cache vote stakes for this account. */
export function cacheVoteStakes(stakes: CachedVoteStake[]): void {
  try {
    localStorage.setItem(acctKey('vote_stakes'), JSON.stringify(stakes));
  } catch { /* ignore */ }
}

// ===== Duel slug map (for resolving on-chain duel IDs to routes) =====

let _slugMap: Record<number, { slug: string; title: string }> | null = null;

/** Fetch and cache the duel slug map from the server. */
export async function getDuelSlugMap(): Promise<Record<number, { slug: string; title: string }>> {
  if (_slugMap) return _slugMap;
  try {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || '';
    const res = await fetch(`${apiUrl}/api/duels/slug-map`);
    if (!res.ok) return {};
    _slugMap = await res.json();
    return _slugMap!;
  } catch {
    return {};
  }
}

/** Look up a duel's slug and title from the cached map. */
export function lookupDuelFromMap(
  map: Record<number, { slug: string; title: string }>,
  dbDuelId: number,
): { slug: string; title: string } | null {
  return map[dbDuelId] || null;
}
