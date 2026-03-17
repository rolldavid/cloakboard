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
  clearVoteDirections();
  // Load persisted vote directions for the new user
  if (userAddress) loadPersistedDirections(userAddress);
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

export interface SyncData {
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  isTallied: boolean;
  options?: Array<{ id: number; label: string; voteCount: number }>;
  levels?: Array<{ level: number; voteCount: number }>;
}

type SyncListener = (cloakAddress: string, duelId: number, data: SyncData) => void;

const syncListeners = new Set<SyncListener>();

export function addSyncListener(fn: SyncListener): () => void {
  syncListeners.add(fn);
  return () => { syncListeners.delete(fn); };
}

function notifyListeners(cloakAddress: string, duelId: number, data: SyncData) {
  for (const fn of syncListeners) {
    try { fn(cloakAddress, duelId, data); } catch { /* listener error */ }
  }
}

export function startBackgroundSync(
  cloakAddress: string,
  duelId: number,
  expectedMin: number,
  syncFn: (cloakAddress: string, duelId: number, expectedMinVotes?: number) => Promise<SyncData>,
): void {
  const key = voteKey(cloakAddress, duelId);

  // Don't start duplicate syncs
  if (activeSyncs.has(key)) return;

  const startedAt = Date.now();
  const timeoutMs = parseInt((import.meta as any).env?.VITE_VOTE_SYNC_TIMEOUT_MS || '180000', 10);
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
    // Configurable timeout (default 3 min, increase for slow testnet via VITE_VOTE_SYNC_TIMEOUT_MS)
    if (Date.now() - startedAt > timeoutMs) {
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

// --- Per-account vote direction store (localStorage-backed, survives reloads) ---
// Stored per-account so switching users doesn't leak direction data.
// The same direction data is already cached in dc_pts_{addr}_vstakes.

const voteDirections = new Map<string, string>();
const VD_STORAGE_PREFIX = 'dc_vd_';

function vdKey(userAddr: string, duelId: number, type: 'dir' | 'opt' | 'lvl', suffix?: string): string {
  return `${type}_${userAddr}_${suffix || duelId}`;
}

/** Load persisted vote directions for the active user into the in-memory map. */
function loadPersistedDirections(userAddr: string): void {
  try {
    const raw = localStorage.getItem(`${VD_STORAGE_PREFIX}${userAddr}`);
    if (!raw) return;
    const entries: [string, string][] = JSON.parse(raw);
    for (const [k, v] of entries) {
      voteDirections.set(k, v);
    }
  } catch { /* ignore corrupt data */ }
}

/** Persist the current in-memory vote directions for a user to localStorage. */
function persistDirections(userAddr: string): void {
  try {
    // Only persist entries for this user
    const entries = [...voteDirections.entries()].filter(([k]) => k.includes(userAddr));
    localStorage.setItem(`${VD_STORAGE_PREFIX}${userAddr}`, JSON.stringify(entries));
  } catch { /* localStorage full */ }
}

/**
 * Store vote direction. Persists to localStorage for cross-reload survival.
 * Writes both period-suffixed and plain keys so DuelCard can look up by plain duelId.
 */
export function setVoteDirection(
  userAddr: string, duelId: number, type: 'dir' | 'opt' | 'lvl',
  value: string, voteKeySuffix?: string,
): void {
  const suffix = voteKeySuffix || `${duelId}`;
  voteDirections.set(vdKey(userAddr, duelId, type, suffix), value);
  if (suffix !== `${duelId}`) {
    voteDirections.set(vdKey(userAddr, duelId, type), value);
  }
  persistDirections(userAddr);
}

/**
 * Get vote direction. Checks in-memory map (populated from localStorage on login).
 */
export function getVoteDirection(
  userAddr: string, duelId: number, type: 'dir' | 'opt' | 'lvl',
  voteKeySuffix?: string,
): string | null {
  if (voteKeySuffix) {
    const val = voteDirections.get(vdKey(userAddr, duelId, type, voteKeySuffix));
    if (val !== undefined) return val;
  }
  return voteDirections.get(vdKey(userAddr, duelId, type)) ?? null;
}

/** Clear all vote directions for a user (called on logout via setVoteTrackerUser(null)). */
function clearVoteDirections(): void {
  voteDirections.clear();
}

// --- Optimistic vote store (survives navigation via localStorage) ---
// Stores per-duel vote deltas keyed by DB duel ID. When the user navigates
// away and back, the delta is re-applied to the fresh server-fetched data
// until the on-chain tx is mined and the server catches up.

interface StoredOptimisticVote {
  duelId: number;
  periodId?: number;
  expectedMinTotal: number;
  totalDelta: number;
  agreeDelta: number;
  disagreeDelta: number;
  optionId?: number;
  level?: number;
  storedAt: number;
}

const OPT_VOTE_PREFIX = 'duelcloak_opt_vote_';
const OPT_VOTE_TTL = 10 * 60 * 1000; // 10 minutes

export function storeOptimisticVote(vote: Omit<StoredOptimisticVote, 'storedAt'>): void {
  try {
    localStorage.setItem(
      `${OPT_VOTE_PREFIX}${vote.duelId}`,
      JSON.stringify({ ...vote, storedAt: Date.now() }),
    );
  } catch { /* quota exceeded */ }
}

export function getOptimisticVote(duelId: number): StoredOptimisticVote | null {
  try {
    const raw = localStorage.getItem(`${OPT_VOTE_PREFIX}${duelId}`);
    if (!raw) return null;
    const vote: StoredOptimisticVote = JSON.parse(raw);
    if (Date.now() - vote.storedAt > OPT_VOTE_TTL) {
      localStorage.removeItem(`${OPT_VOTE_PREFIX}${duelId}`);
      return null;
    }
    return vote;
  } catch { return null; }
}

export function clearOptimisticVote(duelId: number): void {
  try { localStorage.removeItem(`${OPT_VOTE_PREFIX}${duelId}`); } catch { /* ignore */ }
}

/** Apply stored optimistic delta to a duel object. Returns unchanged if no delta or server has caught up. */
export function applyOptimisticVoteToDuel<T extends {
  id: number;
  totalVotes: number;
  agreeCount: number;
  disagreeCount: number;
  options?: Array<{ id: number; voteCount: number; [k: string]: any }> | null;
  levels?: Array<{ level: number; voteCount: number; [k: string]: any }>;
  periods?: Array<{
    id: number;
    totalVotes: number;
    agreeCount: number;
    disagreeCount: number;
    options?: Array<{ id: number; voteCount: number; [k: string]: any }>;
    levels?: Array<{ level: number; voteCount: number; [k: string]: any }>;
  }>;
}>(duel: T): T {
  const vote = getOptimisticVote(duel.id);
  if (!vote) return duel;

  // Determine the authoritative total for comparison
  const checkTotal = vote.periodId
    ? duel.periods?.find((p) => p.id === vote.periodId)?.totalVotes ?? duel.totalVotes
    : duel.totalVotes;

  // Check if the vote has been reflected on the server.
  // Check if the vote has been fully reflected on the server.
  // For multi/level: require the specific option/level count to have increased.
  // For binary: check total votes.
  let serverReflectsVote = false;

  if (vote.optionId != null && duel.options) {
    // Multi-option: require total to have reached expectedMinTotal.
    // Don't use option.voteCount > 0 alone — the option may already have votes from others.
    serverReflectsVote = checkTotal >= vote.expectedMinTotal;
  } else if (vote.level != null && duel.levels) {
    // Level: same — only clear optimistic delta when total catches up.
    serverReflectsVote = checkTotal >= vote.expectedMinTotal;
  } else {
    // Binary: total-based check is sufficient
    serverReflectsVote = checkTotal >= vote.expectedMinTotal;
  }

  if (serverReflectsVote) {
    let fullySynced = true;
    if (vote.optionId != null && duel.options) {
      const opt = duel.options.find((o) => o.id === vote.optionId);
      if (opt && opt.voteCount === 0 && checkTotal > 0) fullySynced = false;
    }
    if (vote.level != null && duel.levels) {
      const lvl = duel.levels.find((l) => l.level === vote.level);
      if (lvl && lvl.voteCount === 0 && checkTotal > 0) fullySynced = false;
    }
    if (fullySynced) {
      clearOptimisticVote(duel.id);
      return duel;
    }
    // Fall through to apply optimistic delta — option/level counts haven't synced yet
  }

  // Patch parent-level counts
  const patched: any = {
    ...duel,
    totalVotes: duel.totalVotes + vote.totalDelta,
    agreeCount: duel.agreeCount + vote.agreeDelta,
    disagreeCount: duel.disagreeCount + vote.disagreeDelta,
  };

  if (vote.optionId != null && patched.options) {
    patched.options = patched.options.map((o: any) =>
      o.id === vote.optionId ? { ...o, voteCount: o.voteCount + 1 } : o,
    );
  }

  if (vote.level != null && patched.levels) {
    patched.levels = patched.levels.map((l: any) =>
      l.level === vote.level ? { ...l, voteCount: l.voteCount + 1 } : l,
    );
  }

  // Patch matching period (for recurring duels)
  if (vote.periodId && patched.periods) {
    patched.periods = patched.periods.map((p: any) => {
      if (p.id !== vote.periodId) return p;
      const pp: any = {
        ...p,
        totalVotes: p.totalVotes + vote.totalDelta,
        agreeCount: p.agreeCount + vote.agreeDelta,
        disagreeCount: p.disagreeCount + vote.disagreeDelta,
      };
      if (vote.optionId != null && pp.options) {
        pp.options = pp.options.map((o: any) =>
          o.id === vote.optionId ? { ...o, voteCount: o.voteCount + 1 } : o,
        );
      }
      if (vote.level != null && pp.levels) {
        pp.levels = pp.levels.map((l: any) =>
          l.level === vote.level ? { ...l, voteCount: l.voteCount + 1 } : l,
        );
      }
      return pp;
    });
  }

  return patched;
}
