/**
 * Vote Tracker — module-level Map + localStorage for tracking pending votes.
 *
 * Survives SPA navigation (in-memory Map). Falls back to localStorage for
 * tab close/refresh. No vote direction is stored (privacy-safe).
 */

interface PendingVote {
  cloakAddress: string;
  duelId: number;
  status: 'proving' | 'confirmed';
  startedAt: number;
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

export function trackVoteStart(cloakAddress: string, duelId: number): void {
  const key = voteKey(cloakAddress, duelId);
  pendingVotes.set(key, {
    cloakAddress,
    duelId,
    status: 'proving',
    startedAt: Date.now(),
  });
  saveToStorage();
}

export function trackVoteConfirmed(cloakAddress: string, duelId: number): void {
  const key = voteKey(cloakAddress, duelId);
  const existing = pendingVotes.get(key);
  if (existing) {
    existing.status = 'confirmed';
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

// Warn before unloading while a proof is in progress
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const hasProving = Array.from(pendingVotes.values()).some(v => v.status === 'proving');
    if (hasProving) {
      e.preventDefault();
    }
  });
}
