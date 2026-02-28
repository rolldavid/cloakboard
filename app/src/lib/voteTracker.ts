/**
 * Vote Tracker — module-level Map + localStorage for tracking pending votes.
 *
 * Survives SPA navigation (in-memory Map). Falls back to localStorage for
 * tab close/refresh. Direction stored in optimisticDelta for UI persistence
 * (localStorage only — privacy-safe since it's the user's own device).
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

const STORAGE_KEY = 'duelcloak_pending_votes';
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// In-memory store survives SPA navigation
const pendingVotes = new Map<string, PendingVote>();

function voteKey(cloakAddress: string, duelId: number): string {
  return `${cloakAddress}:${duelId}`;
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota exceeded, ignore */ }
}

// Load on module init
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

// --- Permanent vote direction store (separate from pending vote lifecycle) ---
// Survives clearVote() and STALE_THRESHOLD. Keyed by cloak+duel, no TTL.
//
// LOW-5 SECURITY NOTE: Vote directions are stored in plaintext localStorage.
// This is INTENTIONAL UX data, NOT security-critical. Rationale:
// - The user already knows how they voted (it's their own device).
// - On-chain vote privacy is guaranteed by Aztec nullifiers regardless.
// - This data is used solely for UI state (showing which button is selected).
// - If localStorage is compromised, the attacker learns nothing beyond what
//   the user already knows about their own votes.
const DIRECTION_KEY = 'duelcloak_vote_directions';

export function saveVoteDirection(cloakAddress: string, duelId: number, direction: 'agree' | 'disagree'): void {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECTION_KEY) || '{}');
    data[`${cloakAddress}:${duelId}`] = direction;
    localStorage.setItem(DIRECTION_KEY, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

export function getSavedVoteDirection(cloakAddress: string, duelId: number): 'agree' | 'disagree' | null {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECTION_KEY) || '{}');
    return data[`${cloakAddress}:${duelId}`] || null;
  } catch { return null; }
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

const activeSyncs = new Map<string, ReturnType<typeof setInterval>>();
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
