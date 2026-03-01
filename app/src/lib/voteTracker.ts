/**
 * Vote Tracker — module-level Map + localStorage for tracking pending votes.
 *
 * Survives SPA navigation (in-memory Map). Falls back to user-scoped
 * localStorage for tab close/refresh (pending votes only, 10min TTL).
 * Vote DIRECTION is never stored on disk — recovered exclusively from
 * VoteHistory contract (encrypted private notes, user-only access).
 */

export interface OptimisticDelta {
  total: number;
  agree: number;
  disagree: number;
}

interface PendingVote {
  cloakAddress: string;
  duelId: number;
  status: 'proving' | 'confirmed';
  startedAt: number;
  expectedMinVotes?: number;
  optimisticDelta?: OptimisticDelta;
}

const STORAGE_KEY_PREFIX = 'duelcloak_pending_votes';
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Current user address — all storage is scoped to this
let currentUserAddress: string | null = null;

// In-memory store survives SPA navigation
const pendingVotes = new Map<string, PendingVote>();

function storageKey(): string {
  return currentUserAddress ? `${STORAGE_KEY_PREFIX}:${currentUserAddress}` : STORAGE_KEY_PREFIX;
}

function voteKey(cloakAddress: string, duelId: number): string {
  return `${cloakAddress}:${duelId}`;
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return;
    const entries: PendingVote[] = JSON.parse(raw);
    const now = Date.now();
    for (const entry of entries) {
      // Discard stale entries
      if (now - entry.startedAt > STALE_THRESHOLD_MS) continue;
      const key = voteKey(entry.cloakAddress, entry.duelId);
      if (!pendingVotes.has(key)) {
        pendingVotes.set(key, entry);
      }
    }
  } catch { /* corrupt storage, ignore */ }
}

function saveToStorage(): void {
  try {
    const entries = Array.from(pendingVotes.values());
    localStorage.setItem(storageKey(), JSON.stringify(entries));
  } catch { /* quota exceeded, ignore */ }
}

// Declare activeSyncs early so setVoteTrackerUser can reference it
const activeSyncs = new Map<string, ReturnType<typeof setInterval>>();

/** Set the current user address. Clears in-memory state and reloads from user-scoped storage. */
export function setVoteTrackerUser(userAddress: string | null): void {
  if (userAddress === currentUserAddress) return;
  currentUserAddress = userAddress;
  // Clear in-memory state from previous user
  pendingVotes.clear();
  // Stop all active syncs from previous user
  for (const [key, interval] of activeSyncs) {
    clearInterval(interval);
    activeSyncs.delete(key);
  }
  // Load new user's data from localStorage
  if (userAddress) loadFromStorage();
}

// Load on module init (no user scoped yet — will reload when setVoteTrackerUser is called)
loadFromStorage();

export function trackVoteStart(cloakAddress: string, duelId: number, optimisticDelta?: OptimisticDelta, expectedMinVotes?: number): void {
  const key = voteKey(cloakAddress, duelId);
  pendingVotes.set(key, {
    cloakAddress,
    duelId,
    status: 'proving',
    startedAt: Date.now(),
    expectedMinVotes,
    optimisticDelta,
  });
  saveToStorage();
}

export function trackVoteConfirmed(cloakAddress: string, duelId: number, expectedMinVotes?: number, optimisticDelta?: OptimisticDelta): void {
  const key = voteKey(cloakAddress, duelId);
  const existing = pendingVotes.get(key);
  if (existing) {
    existing.status = 'confirmed';
    if (expectedMinVotes != null) existing.expectedMinVotes = expectedMinVotes;
    if (optimisticDelta) existing.optimisticDelta = optimisticDelta;
    saveToStorage();
  }
}

export function getPendingVote(cloakAddress: string, duelId: number): PendingVote | undefined {
  const key = voteKey(cloakAddress, duelId);
  const vote = pendingVotes.get(key);
  if (vote && Date.now() - vote.startedAt > STALE_THRESHOLD_MS) {
    pendingVotes.delete(key);
    saveToStorage();
    return undefined;
  }
  return vote;
}

export function clearVote(cloakAddress: string, duelId: number): void {
  pendingVotes.delete(voteKey(cloakAddress, duelId));
  saveToStorage();
}

// --- Optimistic delta application for feed pages ---
// Applies pending vote deltas so duels show correct counts before DB sync.

export function applyOptimisticDeltas<T extends { cloakAddress: string; duelId: number; totalVotes: number; agreeVotes: number; disagreeVotes: number }>(
  duels: T[],
): T[] {
  return duels.map((duel) => {
    const pending = getPendingVote(duel.cloakAddress, duel.duelId);
    if (!pending || !pending.optimisticDelta) return duel;
    const expected = pending.expectedMinVotes ?? (duel.totalVotes + pending.optimisticDelta.total);
    // Only apply delta if DB hasn't caught up yet
    if (duel.totalVotes >= expected) return duel;
    return {
      ...duel,
      totalVotes: duel.totalVotes + pending.optimisticDelta.total,
      agreeVotes: duel.agreeVotes + pending.optimisticDelta.agree,
      disagreeVotes: duel.disagreeVotes + pending.optimisticDelta.disagree,
    };
  });
}

// Warn before unloading while a proof is in progress
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const hasProving = Array.from(pendingVotes.values()).some(v => v.status === 'proving');
    if (hasProving) {
      e.preventDefault();
    }
  });
}

// --- Module-level background sync ---
// Survives SPA navigation (component unmount). Polls /api/duels/sync until
// on-chain vote count matches expectedMinVotes, then clears the pending vote.
// Components can subscribe to updates for UI refresh.

type SyncListener = (cloakAddress: string, duelId: number, data: { totalVotes: number; agreeVotes: number; disagreeVotes: number; isTallied: boolean }) => void;

const syncListeners = new Set<SyncListener>();

export function addSyncListener(fn: SyncListener): () => void {
  syncListeners.add(fn);
  return () => { syncListeners.delete(fn); };
}

function notifyListeners(cloakAddress: string, duelId: number, data: { totalVotes: number; agreeVotes: number; disagreeVotes: number; isTallied: boolean }) {
  for (const fn of syncListeners) {
    try { fn(cloakAddress, duelId, data); } catch { /* listener error */ }
  }
}

export function startBackgroundSync(
  cloakAddress: string,
  duelId: number,
  expectedMin: number,
  syncFn: (cloakAddress: string, duelId: number, expectedMinVotes?: number) => Promise<{ totalVotes: number; agreeVotes: number; disagreeVotes: number; isTallied: boolean }>,
): void {
  const key = voteKey(cloakAddress, duelId);

  // Don't start duplicate syncs
  if (activeSyncs.has(key)) return;

  const startedAt = Date.now();
  let isFirst = true;

  const doSync = () => {
    syncFn(cloakAddress, duelId, isFirst ? expectedMin : undefined)
      .then((data) => {
        isFirst = false;
        notifyListeners(cloakAddress, duelId, data);

        if (data.totalVotes >= expectedMin) {
          clearVote(cloakAddress, duelId);
          stopBackgroundSync(cloakAddress, duelId);
        }
      })
      .catch(() => {
        isFirst = false;
      });
  };

  doSync();
  const interval = setInterval(() => {
    // 3 min timeout
    if (Date.now() - startedAt > 180_000) {
      clearVote(cloakAddress, duelId);
      stopBackgroundSync(cloakAddress, duelId);
      return;
    }
    doSync();
  }, 15_000);

  activeSyncs.set(key, interval);
}

export function stopBackgroundSync(cloakAddress: string, duelId: number): void {
  const key = voteKey(cloakAddress, duelId);
  const interval = activeSyncs.get(key);
  if (interval) {
    clearInterval(interval);
    activeSyncs.delete(key);
  }
}
