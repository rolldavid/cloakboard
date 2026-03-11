import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import {
  fetchDuel, fetchComments, createComment, deleteComment, voteComment, syncDuelVotes,
} from '@/lib/api/duelClient';
import { useCountdown } from '@/hooks/useCountdown';
import { hasPointsBeenAwarded, markPointsAwarded, addOptimisticPoints, getOptimisticPoints } from '@/lib/pointsTracker';
import type { Duel, DuelPeriod, Comment, CommentSort } from '@/lib/api/duelClient';
import { useDuelService } from '@/hooks/useDuelService';
import { VoteChart } from '@/components/duel/VoteChart';
import { MultiOptionChart } from '@/components/duel/MultiOptionChart';
import { MultiItemVote } from '@/components/duel/MultiItemVote';
import { LevelVote } from '@/components/duel/LevelVote';
import { RelatedDuelsSidebar } from '@/components/duel/RelatedDuelsSidebar';
import { VoteCloakingModal } from '@/components/VoteCloakingModal';
import { trackVoteStart, trackVoteConfirmed, getPendingVote, startBackgroundSync, addSyncListener, storeOptimisticVote, clearOptimisticVote, applyOptimisticVoteToDuel } from '@/lib/voteTracker';
import { recheckAccountDeployed, waitForAccountDeploy } from '@/lib/wallet/backgroundWalletService';
import { getAztecClient } from '@/lib/aztec/client';
import { getVoteHistoryArtifact } from '@/lib/aztec/contracts';
import { VoteHistoryService } from '@/lib/aztec/VoteHistoryService';
import { AztecAddress } from '@aztec/aztec.js/addresses';

// --- VoteHistory service (cached, invalidated on account switch) ---
let cachedVoteHistoryService: VoteHistoryService | null = null;
let cachedVHUserAddr: string | null = null;

async function getOrCreateVoteHistoryService(): Promise<VoteHistoryService | null> {
  const client = getAztecClient();
  if (!client || !client.hasWallet()) return null;
  const vhAddress = (import.meta as any).env?.VITE_VOTE_HISTORY_ADDRESS;
  if (!vhAddress) return null;
  const currentAddr = client.getAddress()?.toString() ?? null;
  if (cachedVoteHistoryService && cachedVHUserAddr === currentAddr) return cachedVoteHistoryService;
  // Invalidate — new user or first call
  cachedVoteHistoryService = null;
  cachedVHUserAddr = currentAddr;
  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getVoteHistoryArtifact();
  const addr = AztecAddress.fromString(vhAddress);
  const node = client.getNode();
  if (node) {
    try {
      const instance = await node.getContract(addr);
      if (instance) await wallet.registerContract(instance, artifact);
    } catch { /* already registered */ }
  }
  const svc = new VoteHistoryService(wallet, senderAddress, paymentMethod);
  await svc.connect(addr, artifact);
  cachedVoteHistoryService = svc;
  return svc;
}

/**
 * Record vote on VoteHistory contract (private, encrypted).
 * Delays before first attempt to let the vote tx settle at the node,
 * then retries on failure (concurrent NO_WAIT txs can cause transient collisions).
 */
function recordVoteInBackground(onChainDuelId: number, cloakAddress: string, rawValue: number): void {
  const MAX_RETRIES = 4;
  const INITIAL_DELAY_MS = 30_000; // Wait 30s for vote tx to settle before first attempt
  const RETRY_DELAY_MS = 20_000;   // 20s between retries

  (async () => {
    // Wait for the vote tx (and any ensureCertification tx) to settle
    await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const svc = await getOrCreateVoteHistoryService();
        if (!svc) return;
        await svc.recordVoteRaw(onChainDuelId, cloakAddress, rawValue);
        console.log(`[VoteHistory] Recorded vote (attempt ${attempt + 1})`);
        return;
      } catch (err: any) {
        const msg = err?.message ?? '';
        console.warn(`[VoteHistory] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, msg);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    console.error('[VoteHistory] All retries exhausted — vote direction not recorded on-chain');
  })();
}

const SORT_OPTIONS: { key: CommentSort; label: string }[] = [
  { key: 'best', label: 'Best' },
  { key: 'new', label: 'New' },
  { key: 'top', label: 'Top' },
  { key: 'old', label: 'Old' },
];

export function DuelDetailPage() {
  const { duelSlug, periodSlug } = useParams<{ duelSlug: string; periodSlug?: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isDeployed, userAddress, userName } = useAppStore();
  const { service: duelService, loading: serviceLoading } = useDuelService();

  const [duel, setDuel] = useState<Duel | null>(null);
  const duelId = duel?.id ?? 0;
  const [activePeriod, setActivePeriod] = useState<DuelPeriod | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSort, setCommentSort] = useState<CommentSort>('best');
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [votedDirection, setVotedDirection] = useState<boolean | null>(null);
  const [votedOptionId, setVotedOptionId] = useState<number | null>(null);
  const [votedLevel, setVotedLevel] = useState<number | null>(null);
  const [hasVotedUnknownDir, setHasVotedUnknownDir] = useState(false); // voted but direction unknown
  const [showCloakingModal, setShowCloakingModal] = useState(false);
  const [votePromise, setVotePromise] = useState<Promise<void> | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const voteHistoryChecked = useRef<string | null>(null); // tracks "userAddress:duelId" to avoid re-querying

  const isRecurring = duel?.timingType === 'recurring';
  const periods = duel?.periods || [];

  // Load duel — applies stored optimistic delta so vote counts survive navigation
  const loadDuel = useCallback(async () => {
    if (!duelSlug) return;
    try {
      const d = await fetchDuel(duelSlug);
      setDuel(applyOptimisticVoteToDuel(d));
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [duelSlug]);

  // Load comments (period-scoped for recurring duels)
  // Stale request counter prevents out-of-order responses from overwriting fresh data
  const initialCommentsLoaded = useRef(false);
  const commentsRequestId = useRef(0);
  const loadComments = useCallback(async () => {
    if (!duelId) return;
    const requestId = ++commentsRequestId.current;
    if (!initialCommentsLoaded.current) setCommentsLoading(true);
    try {
      const data = await fetchComments({
        duelId,
        sort: commentSort,
        viewer: userAddress || undefined,
        periodId: isRecurring && activePeriod ? activePeriod.id : undefined,
      });
      if (requestId !== commentsRequestId.current) return; // stale response
      setComments(data.comments);
      initialCommentsLoaded.current = true;
    } catch (err: any) {
      if (requestId !== commentsRequestId.current) return;
      console.warn('[Comments] Failed to load:', err?.message);
    }
    setCommentsLoading(false);
  }, [duelId, commentSort, userAddress, isRecurring, activePeriod?.id]);

  useEffect(() => { loadDuel(); }, [loadDuel, userAddress]);
  useEffect(() => { loadComments(); }, [loadComments]);

  // Resolve activePeriod from URL slug or default to latest.
  // Always use fresh period objects from the API so status/onChainId/date changes propagate.
  const periodIds = periods.map((p) => p.id).join(',');
  const latestPeriodOnChainId = periods[0]?.onChainId ?? null;
  const latestPeriodStatus = periods[0]?.status ?? null;
  useEffect(() => {
    if (!duel || !isRecurring || periods.length === 0) {
      setActivePeriod(null);
      return;
    }
    if (periodSlug) {
      const match = periods.find((p) => p.slug === periodSlug);
      if (match) {
        setActivePeriod(match);
        return;
      }
    }
    // No slug — always use latest (current) period from fresh API data.
    // Previous code kept the old period object if its ID still existed, which caused
    // stale date/status/chart data when a new period was created by the cron.
    setActivePeriod(periods[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecurring, periodIds, periodSlug, latestPeriodOnChainId, latestPeriodStatus]);

  // Auto-refresh while on-chain setup is pending (duel-level or period-level)
  useEffect(() => {
    const needsPoll = isRecurring
      ? (activePeriod && activePeriod.onChainId === null)
      : (duel && duel.onChainId === null);
    if (!needsPoll) return;
    const interval = setInterval(() => loadDuel(), 5000);
    return () => clearInterval(interval);
  }, [duel?.onChainId, activePeriod?.onChainId, isRecurring, loadDuel]);

  // localStorage key suffix: append period ID for recurring duels
  const voteKeySuffix = isRecurring && activePeriod ? `${duelId}_p${activePeriod.id}` : `${duelId}`;

  // Restore vote state from localStorage, scoped per user (private, never touches server)
  useEffect(() => {
    if (!duel) return;
    // Reset vote state when account or period changes
    setVotedDirection(null);
    setVotedOptionId(null);
    setVotedLevel(null);

    if (!userAddress) return;

    if (duel.duelType === 'binary') {
      try {
        const stored = localStorage.getItem(`duelcloak_voted_dir_${userAddress}_${voteKeySuffix}`);
        if (stored !== null) setVotedDirection(stored === '1');
      } catch {}
    }

    if (duel.duelType === 'multi') {
      try {
        const stored = localStorage.getItem(`duelcloak_voted_opt_${userAddress}_${voteKeySuffix}`);
        if (stored) setVotedOptionId(parseInt(stored, 10));
      } catch {}
    }

    if (duel.duelType === 'level') {
      try {
        const stored = localStorage.getItem(`duelcloak_voted_lvl_${userAddress}_${voteKeySuffix}`);
        if (stored) setVotedLevel(parseInt(stored, 10));
      } catch {}
    }
  }, [duel?.onChainId, duel?.duelType, duelId, userAddress, voteKeySuffix, activePeriod?.id]);

  // Recover vote from on-chain VoteHistory (permanent backup — survives localStorage clears + device changes).
  // Retries 3× with 3s delay because the ephemeral PXE may not have synced the block with the note yet.
  const recoverVoteFromHistory = useCallback(async (retries = 3) => {
    if (!duel || !duelService) return;
    const onChainId = isRecurring && activePeriod ? activePeriod.onChainId : duel.onChainId;
    if (onChainId === null) return;
    try {
      const svc = await getOrCreateVoteHistoryService();
      if (!svc) return;
      const cloakAddress = duelService.getAddress();
      if (!cloakAddress) return;

      let raw: number | null = null;
      for (let attempt = 0; attempt < retries; attempt++) {
        raw = await svc.getMyVoteRaw(onChainId, cloakAddress);
        if (raw !== null) break;
        if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 3000));
      }
      if (raw === null) return;

      // Decode based on duel type and update state + localStorage cache
      if (duel.duelType === 'binary') {
        const dir = raw === 1;
        setVotedDirection(dir);
        try {
          localStorage.setItem(`duelcloak_voted_dir_${userAddress}_${voteKeySuffix}`, dir ? '1' : '0');
          if (voteKeySuffix !== `${duelId}`) localStorage.setItem(`duelcloak_voted_dir_${userAddress}_${duelId}`, dir ? '1' : '0');
        } catch {}
      } else if (duel.duelType === 'multi' && duel.options) {
        // On-chain index = creation order (sorted by DB id ascending)
        const creationOrder = [...duel.options].sort((a, b) => a.id - b.id);
        const optionIndex = raw - 10;
        if (optionIndex >= 0 && optionIndex < creationOrder.length) {
          const optId = creationOrder[optionIndex].id;
          setVotedOptionId(optId);
          try {
            localStorage.setItem(`duelcloak_voted_opt_${userAddress}_${voteKeySuffix}`, String(optId));
            if (voteKeySuffix !== `${duelId}`) localStorage.setItem(`duelcloak_voted_opt_${userAddress}_${duelId}`, String(optId));
          } catch {}
        }
      } else if (duel.duelType === 'level') {
        const level = raw - 100;
        if (level >= 1 && level <= 10) {
          setVotedLevel(level);
          try {
            localStorage.setItem(`duelcloak_voted_lvl_${userAddress}_${voteKeySuffix}`, String(level));
            if (voteKeySuffix !== `${duelId}`) localStorage.setItem(`duelcloak_voted_lvl_${userAddress}_${duelId}`, String(level));
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn('[VoteHistory] Recovery failed:', err?.message);
    }
  }, [duel, duelService, userAddress, duelId, isRecurring, activePeriod, voteKeySuffix]);

  useEffect(() => {
    if (!duel || !duelService || !isAuthenticated || !userAddress) return;
    if (duel.onChainId === null) return;
    // Only query once per user+duel combination
    const checkKey = `${userAddress}:${duelId}`;
    if (voteHistoryChecked.current === checkKey) return;
    voteHistoryChecked.current = checkKey;

    // Try VoteHistory first, then fall back to simulation-based nullifier check
    (async () => {
      await recoverVoteFromHistory();
      // If VoteHistory didn't find a vote, check via simulation (detects nullifier collision ~2-3s)
      if (votedDirection === null && votedOptionId === null && votedLevel === null && !hasVotedUnknownDir) {
        try {
          const onChainId = isRecurring && activePeriod ? activePeriod.onChainId : duel.onChainId;
          if (onChainId === null) return;
          const alreadyVoted = await duelService.checkAlreadyVoted(onChainId, duel.duelType as 'binary' | 'multi' | 'level');
          if (alreadyVoted) {
            console.log('[VoteRecovery] Nullifier check: already voted on duel', onChainId);
            setHasVotedUnknownDir(true);
            // Try VoteHistory one more time with longer delays (PXE may have caught up)
            recoverVoteFromHistory(5);
          }
        } catch (err: any) {
          console.warn('[VoteRecovery] checkAlreadyVoted failed:', err?.message);
        }
      }
    })();
  }, [duel?.onChainId, duelService, isAuthenticated, userAddress, duelId, recoverVoteFromHistory, isRecurring, activePeriod]);

  // Listen for background sync updates (on-chain duels only)
  useEffect(() => {
    const onChainId = isRecurring && activePeriod ? activePeriod.onChainId : duel?.onChainId;
    if (!duel || onChainId === null || onChainId === undefined) return;
    const unsub = addSyncListener((_cloakAddr, syncDuelId, data) => {
      if (syncDuelId === onChainId) {
        setDuel((prev) => {
          if (!prev) return prev;
          const updated: Duel = {
            ...prev,
            agreeCount: Math.max(prev.agreeCount, data.agreeVotes),
            disagreeCount: Math.max(prev.disagreeCount, data.disagreeVotes),
            totalVotes: Math.max(prev.totalVotes, data.totalVotes),
          };
          if (data.options && prev.options) {
            updated.options = prev.options.map((o) => {
              const synced = data.options!.find((so) => so.id === o.id);
              return synced ? { ...o, voteCount: Math.max(o.voteCount, synced.voteCount) } : o;
            });
          }
          if (data.levels && prev.levels) {
            updated.levels = prev.levels.map((l) => {
              const synced = data.levels!.find((sl) => sl.level === l.level);
              return synced ? { ...l, voteCount: Math.max(l.voteCount, synced.voteCount) } : l;
            });
          }
          return updated;
        });
        if (isRecurring) {
          setActivePeriod((prev) => {
            if (!prev) return prev;
            const updated: DuelPeriod = {
              ...prev,
              agreeCount: Math.max(prev.agreeCount, data.agreeVotes),
              disagreeCount: Math.max(prev.disagreeCount, data.disagreeVotes),
              totalVotes: Math.max(prev.totalVotes, data.totalVotes),
            };
            if (data.options && prev.options) {
              updated.options = prev.options.map((o) => {
                const synced = data.options!.find((so) => so.id === o.id);
                return synced ? { ...o, voteCount: Math.max(o.voteCount, synced.voteCount) } : o;
              });
            }
            if (data.levels && prev.levels) {
              updated.levels = prev.levels.map((l) => {
                const synced = data.levels!.find((sl) => sl.level === l.level);
                return synced ? { ...l, voteCount: Math.max(l.voteCount, synced.voteCount) } : l;
              });
            }
            return updated;
          });
        }
        setRefreshKey((k) => k + 1);
      }
    });
    return unsub;
  }, [duel?.onChainId, isRecurring, activePeriod?.onChainId]);

  // Stable callback for modal dismiss — state setters are stable, so deps are empty.
  // Without this, the inline arrow fn changes reference every render, resetting the modal's auto-close timer.
  const handleModalComplete = useCallback(() => {
    setShowCloakingModal(false);
    setVotePromise(null);
    // Defensive: re-read vote direction from localStorage if state was lost during modal
    const addr = useAppStore.getState().userAddress;
    if (addr && duelId) {
      try {
        const dir = localStorage.getItem(`duelcloak_voted_dir_${addr}_${voteKeySuffix}`);
        if (dir !== null) setVotedDirection(dir === '1');
        const opt = localStorage.getItem(`duelcloak_voted_opt_${addr}_${voteKeySuffix}`);
        if (opt) setVotedOptionId(parseInt(opt, 10));
        const lvl = localStorage.getItem(`duelcloak_voted_lvl_${addr}_${voteKeySuffix}`);
        if (lvl) setVotedLevel(parseInt(lvl, 10));
      } catch {}
    }
  }, [duelId, voteKeySuffix]);

  // Sync adapter for background sync — maps DB sync to voteTracker format
  const makeSyncFn = useCallback((dbDuelId: number, pId?: number) => {
    return async (_addr: string, _id: number) => {
      const result = await syncDuelVotes(dbDuelId, pId);
      return {
        totalVotes: result.totalVotes,
        agreeVotes: result.agreeCount,
        disagreeVotes: result.disagreeCount,
        isTallied: true,
        options: result.options,
        levels: result.levels,
      };
    };
  }, []);

  // Resolve the effective on-chain ID for voting (period-level for recurring, duel-level otherwise)
  const effectiveOnChainId = isRecurring && activePeriod ? activePeriod.onChainId : duel?.onChainId;
  const periodIsEnded = isRecurring && activePeriod ? activePeriod.status === 'ended' : false;

  // ─── Binary Vote ───
  const handleBinaryVote = async (support: boolean) => {
    if (!duel) return;
    if (votedDirection !== null || hasVotedUnknownDir) return; // already voted — guard against race
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duelSlug}`);
      navigate('/login');
      return;
    }

    setShowCloakingModal(true);
    setVoteError(null);

    const pointsKey = `vote-${voteKeySuffix}-${support}`;
    const delta = { total: 1, agree: support ? 1 : 0, disagree: support ? 0 : 1 };

    // Optimistic count updates BEFORE proof — instant UI feedback on mobile (proof takes 50-75s).
    // Vote direction indicator is set AFTER castVote succeeds to avoid phantom votes.
    setDuel((prev) => prev ? {
      ...prev,
      agreeCount: prev.agreeCount + (support ? 1 : 0),
      disagreeCount: prev.disagreeCount + (support ? 0 : 1),
      totalVotes: prev.totalVotes + 1,
    } : prev);
    if (isRecurring && activePeriod) {
      setActivePeriod((prev) => prev ? {
        ...prev,
        agreeCount: prev.agreeCount + (support ? 1 : 0),
        disagreeCount: prev.disagreeCount + (support ? 0 : 1),
        totalVotes: prev.totalVotes + 1,
      } : prev);
    }
    setRefreshKey((k) => k + 1);
    storeOptimisticVote({
      duelId,
      periodId: isRecurring && activePeriod ? activePeriod.id : undefined,
      expectedMinTotal: duel.totalVotes + 1,
      totalDelta: 1,
      agreeDelta: support ? 1 : 0,
      disagreeDelta: support ? 0 : 1,
    });

    const promise = (async () => {
      if (effectiveOnChainId === null || effectiveOnChainId === undefined || !duelService) {
        throw new Error('On-chain voting not ready yet');
      }

      // On-chain private vote
      if (!(await recheckAccountDeployed())) {
        await waitForAccountDeploy();
      }

      const contractAddr = duelService.getAddress() || '';
      trackVoteStart(contractAddr, effectiveOnChainId, delta, duel.totalVotes + 1);
      await duelService.castVote(effectiveOnChainId, support);
      trackVoteConfirmed(contractAddr, effectiveOnChainId, duel.totalVotes + 1, delta);

      // Mark vote direction only after successful cast
      setVotedDirection(support);
      try {
        localStorage.setItem(`duelcloak_voted_dir_${userAddress}_${voteKeySuffix}`, support ? '1' : '0');
        if (voteKeySuffix !== `${duelId}`) {
          localStorage.setItem(`duelcloak_voted_dir_${userAddress}_${duelId}`, support ? '1' : '0');
        }
      } catch {}

      // Start background sync
      startBackgroundSync(contractAddr, effectiveOnChainId, duel.totalVotes + 1, makeSyncFn(duelId, activePeriod?.id));

      // Points awarded atomically on-chain via cross-contract call -- no separate tx needed
      if (!hasPointsBeenAwarded(pointsKey)) {
        markPointsAwarded(pointsKey);
        addOptimisticPoints(10);
        const { ensureCertification, isCertified } = await import('@/lib/wallet/backgroundWalletService');
        if (getOptimisticPoints() >= 10 && !isCertified()) {
          ensureCertification().catch(() => {});
        }
        setTimeout(async () => {
          try { const { refreshPointsOnChain } = await import('@/lib/wallet/backgroundWalletService'); await refreshPointsOnChain(); } catch {}
        }, 15_000);
      }

      // Record vote direction on VoteHistory (private, fire-and-forget)
      recordVoteInBackground(effectiveOnChainId, contractAddr, support ? 1 : 0);
    })();

    promise.catch((err) => {
      const msg = String(err?.message || err || '');
      if (msg.includes('nullifier') || msg.includes('already voted')) {
        clearOptimisticVote(duelId);
        loadDuel();
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        loadDuel();
      }
      setShowCloakingModal(false);
      setVotePromise(null);
    });

    setVotePromise(promise);
  };

  // ─── Multi-item Vote ───
  const handleOptionVote = async (optionId: number) => {
    if (!duel || !duel.options) return;
    if (votedOptionId !== null || hasVotedUnknownDir) return; // already voted — guard against race
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duelSlug}`);
      navigate('/login');
      return;
    }

    const option = duel.options.find((o) => o.id === optionId);
    if (!option) return;

    // On-chain index = position in creation order (sorted by DB id ascending).
    // The API returns options ORDER BY vote_count DESC, so we must sort by id to match on-chain.
    const creationOrder = [...duel.options].sort((a, b) => a.id - b.id);
    const onChainIndex = creationOrder.findIndex((o) => o.id === optionId);
    if (onChainIndex < 0) return;

    setShowCloakingModal(true);
    setVoteError(null);

    // Optimistic count updates BEFORE proof — vote indicator set after castVote succeeds.
    setDuel((prev) => {
      if (!prev || !prev.options) return prev;
      return {
        ...prev,
        totalVotes: prev.totalVotes + 1,
        options: prev.options.map((o) =>
          o.id === optionId ? { ...o, voteCount: o.voteCount + 1 } : o
        ),
      };
    });
    if (isRecurring && activePeriod) {
      setActivePeriod((prev) => {
        if (!prev || !prev.options) return prev;
        return {
          ...prev,
          totalVotes: prev.totalVotes + 1,
          options: prev.options.map((o) =>
            o.id === optionId ? { ...o, voteCount: o.voteCount + 1 } : o
          ),
        };
      });
    }
    setRefreshKey((k) => k + 1);
    storeOptimisticVote({
      duelId,
      periodId: isRecurring && activePeriod ? activePeriod.id : undefined,
      expectedMinTotal: duel.totalVotes + 1,
      totalDelta: 1,
      agreeDelta: 0,
      disagreeDelta: 0,
      optionId: option.id,
    });

    const promise = (async () => {
      if (effectiveOnChainId === null || effectiveOnChainId === undefined || !duelService) {
        throw new Error('On-chain voting not ready yet');
      }

      if (!(await recheckAccountDeployed())) {
        await waitForAccountDeploy();
      }

      const contractAddr = duelService.getAddress() || '';
      const delta = { total: 1, agree: 0, disagree: 0 };
      trackVoteStart(contractAddr, effectiveOnChainId, delta, duel.totalVotes + 1);
      await duelService.castVoteOption(BigInt(effectiveOnChainId), BigInt(onChainIndex));
      trackVoteConfirmed(contractAddr, effectiveOnChainId, duel.totalVotes + 1, delta);

      // Mark vote indicator only after successful cast
      setVotedOptionId(option.id);
      try {
        localStorage.setItem(`duelcloak_voted_opt_${userAddress}_${voteKeySuffix}`, String(option.id));
        if (voteKeySuffix !== `${duelId}`) {
          localStorage.setItem(`duelcloak_voted_opt_${userAddress}_${duelId}`, String(option.id));
        }
      } catch {}

      startBackgroundSync(contractAddr, effectiveOnChainId, duel.totalVotes + 1, makeSyncFn(duelId, activePeriod?.id));

      // Points awarded atomically on-chain via cross-contract call
      const pointsKey = `vote-opt-${voteKeySuffix}-${onChainIndex}`;
      if (!hasPointsBeenAwarded(pointsKey)) {
        markPointsAwarded(pointsKey);
        addOptimisticPoints(10);
        const { ensureCertification, isCertified } = await import('@/lib/wallet/backgroundWalletService');
        if (getOptimisticPoints() >= 10 && !isCertified()) {
          ensureCertification().catch(() => {});
        }
        setTimeout(async () => {
          try { const { refreshPointsOnChain } = await import('@/lib/wallet/backgroundWalletService'); await refreshPointsOnChain(); } catch {}
        }, 15_000);
      }

      // Record vote on VoteHistory (private, fire-and-forget). Encoding: onChainIndex + 10
      recordVoteInBackground(effectiveOnChainId, contractAddr, onChainIndex + 10);
    })();

    promise.catch((err) => {
      const msg = String(err?.message || err || '');
      if (msg.includes('nullifier') || msg.includes('already voted')) {
        clearOptimisticVote(duelId);
        loadDuel();
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        loadDuel();
      }
      setShowCloakingModal(false);
      setVotePromise(null);
    });

    setVotePromise(promise);
  };

  // ─── Level Vote ───
  const handleLevelVote = async (level: number) => {
    if (!duel) return;
    if (votedLevel !== null || hasVotedUnknownDir) return; // already voted — guard against race
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duelSlug}`);
      navigate('/login');
      return;
    }

    setShowCloakingModal(true);
    setVoteError(null);

    // Optimistic count updates BEFORE proof — vote indicator set after castVote succeeds.
    setDuel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        totalVotes: prev.totalVotes + 1,
        levels: prev.levels?.map((l) =>
          l.level === level ? { ...l, voteCount: l.voteCount + 1 } : l
        ),
      };
    });
    if (isRecurring && activePeriod) {
      setActivePeriod((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          totalVotes: prev.totalVotes + 1,
          levels: prev.levels?.map((l) =>
            l.level === level ? { ...l, voteCount: l.voteCount + 1 } : l
          ),
        };
      });
    }
    setRefreshKey((k) => k + 1);
    storeOptimisticVote({
      duelId,
      periodId: isRecurring && activePeriod ? activePeriod.id : undefined,
      expectedMinTotal: duel.totalVotes + 1,
      totalDelta: 1,
      agreeDelta: 0,
      disagreeDelta: 0,
      level,
    });

    const promise = (async () => {
      if (effectiveOnChainId === null || effectiveOnChainId === undefined || !duelService) {
        throw new Error('On-chain voting not ready yet');
      }

      if (!(await recheckAccountDeployed())) {
        await waitForAccountDeploy();
      }

      const contractAddr = duelService.getAddress() || '';
      const delta = { total: 1, agree: 0, disagree: 0 };
      trackVoteStart(contractAddr, effectiveOnChainId, delta, duel.totalVotes + 1);
      await duelService.castVoteLevel(BigInt(effectiveOnChainId), BigInt(level));
      trackVoteConfirmed(contractAddr, effectiveOnChainId, duel.totalVotes + 1, delta);

      // Mark vote indicator only after successful cast
      setVotedLevel(level);
      try {
        localStorage.setItem(`duelcloak_voted_lvl_${userAddress}_${voteKeySuffix}`, String(level));
        if (voteKeySuffix !== `${duelId}`) {
          localStorage.setItem(`duelcloak_voted_lvl_${userAddress}_${duelId}`, String(level));
        }
      } catch {}

      startBackgroundSync(contractAddr, effectiveOnChainId, duel.totalVotes + 1, makeSyncFn(duelId, activePeriod?.id));

      // Points awarded atomically on-chain via cross-contract call
      const pointsKey = `vote-lvl-${voteKeySuffix}-${level}`;
      if (!hasPointsBeenAwarded(pointsKey)) {
        markPointsAwarded(pointsKey);
        addOptimisticPoints(10);
        const { ensureCertification, isCertified } = await import('@/lib/wallet/backgroundWalletService');
        if (getOptimisticPoints() >= 10 && !isCertified()) {
          ensureCertification().catch(() => {});
        }
        setTimeout(async () => {
          try { const { refreshPointsOnChain } = await import('@/lib/wallet/backgroundWalletService'); await refreshPointsOnChain(); } catch {}
        }, 15_000);
      }

      // Record vote on VoteHistory (private, fire-and-forget). Encoding: level + 100
      recordVoteInBackground(effectiveOnChainId, contractAddr, level + 100);
    })();

    promise.catch((err) => {
      const msg = String(err?.message || err || '');
      if (msg.includes('nullifier') || msg.includes('already voted')) {
        clearOptimisticVote(duelId);
        loadDuel();
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        loadDuel();
      }
      setShowCloakingModal(false);
      setVotePromise(null);
    });

    setVotePromise(promise);
  };

  // ─── Comments ───
  const handleCreateComment = async () => {
    if (!newComment.trim() || !userAddress || !userName) return;
    try {
      const comment = await createComment(
        { address: userAddress, name: userName },
        { duelId, parentId: replyTo || undefined, body: newComment.trim(), periodId: isRecurring && activePeriod ? activePeriod.id : undefined },
      );
      setComments((prev) => {
        if (!comment.parentId) return [comment, ...prev];
        // Insert reply after its parent (and any existing replies to that parent)
        const idx = prev.findIndex((c) => c.id === comment.parentId);
        if (idx === -1) return [comment, ...prev];
        const result = [...prev];
        result.splice(idx + 1, 0, comment);
        return result;
      });
      setNewComment('');
      setReplyTo(null);

      // Optimistic points for commenting (on-chain points only awarded via voting)
      const pointsKey = `comment-${duelId}-${comment.id}`;
      if (!hasPointsBeenAwarded(pointsKey)) {
        markPointsAwarded(pointsKey);
        addOptimisticPoints(5);
      }
    } catch (err: any) {
      console.error('Failed to create comment:', err?.message);
    }
  };

  const handleVoteComment = async (commentId: number, direction: 1 | -1 | 0) => {
    if (!userAddress || !userName) return;

    // Snapshot for rollback on failure
    const prevComments = comments;

    // Optimistic UI update — apply immediately before API call
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const oldDir = c.myVote;
        let upDelta = 0;
        let downDelta = 0;
        // Remove old vote
        if (oldDir === 1) upDelta--;
        else if (oldDir === -1) downDelta--;
        // Apply new vote
        if (direction === 1) upDelta++;
        else if (direction === -1) downDelta++;
        return {
          ...c,
          upvotes: Math.max(0, c.upvotes + upDelta),
          downvotes: Math.max(0, c.downvotes + downDelta),
          myVote: direction === 0 ? null : direction,
        };
      }),
    );

    // Optimistic points for upvoting (on-chain points only awarded via voting)
    if (direction === 1) {
      const pointsKey = `comment-vote-${commentId}`;
      if (!hasPointsBeenAwarded(pointsKey)) {
        markPointsAwarded(pointsKey);
        addOptimisticPoints(2);
      }
    }

    try {
      const result = await voteComment(
        { address: userAddress, name: userName },
        commentId,
        direction,
      );
      // Reconcile with server truth
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, upvotes: result.upvotes, downvotes: result.downvotes, myVote: result.myVote } : c,
        ),
      );
    } catch {
      // Revert optimistic update — vote wasn't saved (e.g. 401, network error)
      setComments(prevComments);
    }
  };

  const countdownBlock = isRecurring && activePeriod ? activePeriod.endBlock : duel?.endBlock;
  const { timeLeft: countdown, secondsLeft, isClosing, hasEnded: countdownEnded } = useCountdown(countdownBlock);
  const isEndingSoon = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 3600;

  if (loading || !duel) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Use period-level counts for recurring duels
  const displayAgreeCount = isRecurring && activePeriod ? activePeriod.agreeCount : duel.agreeCount;
  const displayDisagreeCount = isRecurring && activePeriod ? activePeriod.disagreeCount : duel.disagreeCount;
  const displayTotalVotes = isRecurring && activePeriod ? activePeriod.totalVotes : duel.totalVotes;
  const displayOptions = isRecurring && activePeriod?.options ? activePeriod.options : duel.options;
  const displayLevels = isRecurring && activePeriod?.levels ? activePeriod.levels : duel.levels;

  const isActive = duel.status === 'active';
  const canVote = isActive && !periodIsEnded;

  const agreeLabel = 'Agree';
  const disagreeLabel = 'Disagree';

  return (
    <>
    {/* Full-width account setup banner — breaks out of max-w container */}
    {isAuthenticated && !isDeployed && canVote && !countdownEnded && (
      <DeployBanner />
    )}
    <div className="flex gap-6 max-w-6xl mx-auto">
      {/* Main content */}
      <div className="flex-1 min-w-0 max-w-3xl">
      {/* Breadcrumb + status */}
      <div className="flex items-center justify-between mb-4">
        {(duel.categorySlug || duel.subcategorySlug) ? (
          <div className="flex items-center gap-1 text-xs text-foreground-muted">
            {duel.categorySlug && (
              <Link to={`/c/${duel.categorySlug}`} className="hover:text-accent transition-colors">
                {duel.categoryName}
              </Link>
            )}
            {duel.subcategorySlug && duel.categorySlug && (
              <>
                <span>/</span>
                <Link to={`/c/${duel.categorySlug}/${duel.subcategorySlug}`} className="hover:text-accent transition-colors">
                  {duel.subcategoryName}
                </Link>
              </>
            )}
          </div>
        ) : <div />}
        <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full font-medium ${
          isActive ? 'bg-vote-agree/20 text-vote-agree' : 'bg-foreground-muted/20 text-foreground-muted'
        }`}>
          {isActive ? 'Active' : 'Ended'}
        </span>
      </div>

      {/* Breaking headline — prominent context block (above statement) */}
      {duel.isBreaking && duel.breakingHeadline && (
        <div className="bg-surface border border-border rounded-lg px-4 py-3 mb-4 flex items-center gap-3">
          <span className="shrink-0 px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-red-600 text-white rounded">
            Breaking
          </span>
          <p className="text-sm font-medium text-foreground-secondary italic leading-snug flex-1">
            {duel.breakingHeadline}
          </p>
          {duel.breakingSourceUrl && (
            <a
              href={duel.breakingSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:text-accent-hover transition-colors whitespace-nowrap flex-shrink-0"
            >
              {new URL(duel.breakingSourceUrl).hostname.replace(/^www\./, '')} &rarr;
            </a>
          )}
        </div>
      )}

      {/* Title */}
      <h1 className="text-xl font-bold text-foreground mb-2">{duel.title}</h1>

      {/* Voting period (shown when ended) — uses browser local timezone to match chart */}
      {!isActive && duel.createdAt && duel.endsAt && (() => {
        const fmt = (d: Date) =>
          d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
          d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        const start = new Date(duel.createdAt);
        const end = new Date(duel.endsAt);
        const sameDay = start.toLocaleDateString() === end.toLocaleDateString();
        const timeFmt = (d: Date) =>
          d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        const period = sameDay
          ? `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeFmt(start)} – ${timeFmt(end)}`
          : `${fmt(start)} – ${fmt(end)}`;
        return (
          <p className="text-xs text-foreground-muted mb-2">
            Voting period: {period}
          </p>
        );
      })()}

      {/* Non-breaking description */}
      {!duel.isBreaking && duel.description && (
        <p className="text-sm text-foreground-secondary mb-4">{duel.description}</p>
      )}

      {/* Period navigation bar (recurring duels only) */}
      {isRecurring && activePeriod && periods.length > 0 && (() => {
        const currentIdx = periods.findIndex((p) => p.id === activePeriod.id);
        const canGoNewer = currentIdx > 0;
        const canGoOlder = currentIdx < periods.length - 1;
        const isCurrent = currentIdx === 0;

        const formatPeriodLabel = (p: DuelPeriod) => {
          // Use slug (YYYY-MM-DD / YYYY-MM / YYYY) to avoid timezone conversion issues
          if (p.slug) {
            const parts = p.slug.split('-').map(Number);
            if (duel.recurrence === 'daily' && parts.length === 3) {
              return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }
            if (duel.recurrence === 'monthly' && parts.length >= 2) {
              return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            }
            if (duel.recurrence === 'yearly') return String(parts[0]);
          }
          return p.slug || '';
        };

        return (
          <div className="flex items-center justify-center gap-4 mb-6 py-2 bg-surface border border-border rounded-lg">
            <button
              onClick={() => {
                if (canGoOlder) {
                  const olderPeriod = periods[currentIdx + 1];
                  navigate(`/d/${duelSlug}/${olderPeriod.slug}`, { replace: true });
                }
              }}
              disabled={!canGoOlder}
              className="px-2 py-1 text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors"
            >
              &#9664;
            </button>
            <div className="text-center min-w-[180px]">
              <div className="text-sm font-semibold text-foreground">
                {formatPeriodLabel(activePeriod)}
                {isCurrent && <span className="ml-2 text-xs font-normal text-accent">(Current)</span>}
              </div>
              <div className="text-xs text-foreground-muted">
                {activePeriod.totalVotes} vote{activePeriod.totalVotes !== 1 ? 's' : ''}
                {periodIsEnded && <span className="ml-1 text-red-400">· Ended</span>}
              </div>
            </div>
            <button
              onClick={() => {
                if (canGoNewer) {
                  const newerPeriod = periods[currentIdx - 1];
                  const target = currentIdx - 1 === 0
                    ? `/d/${duelSlug}`
                    : `/d/${duelSlug}/${newerPeriod.slug}`;
                  navigate(target, { replace: true });
                }
              }}
              disabled={!canGoNewer}
              className="px-2 py-1 text-foreground-muted hover:text-foreground disabled:opacity-30 transition-colors"
            >
              &#9654;
            </button>
          </div>
        );
      })()}

      {/* Period ended message */}
      {periodIsEnded && (
        <div className="mb-4 p-3 bg-foreground-muted/10 border border-border rounded-lg text-center text-sm text-foreground-muted">
          This period has ended. Browse other periods using the navigation above.
        </div>
      )}

      {/* Binary chart — above vote buttons */}
      {duel.duelType === 'binary' && (
        <div className="mb-6">
          <VoteChart
            duelId={duelId}
            createdAt={activePeriod?.periodStart || duel.createdAt}
            endsAt={activePeriod?.periodEnd || duel.endsAt}
            agreeVotes={displayAgreeCount}
            disagreeVotes={displayDisagreeCount}
            totalVotes={displayTotalVotes}
            isEnded={!canVote}
            refreshKey={refreshKey}
            periodId={activePeriod?.id}
            isBreaking={duel.isBreaking}
          />
        </div>
      )}

      {/* Vote section */}
      <div className={`bg-surface border rounded-lg p-5 mb-6 ${
        isClosing ? 'border-red-500/50 shadow-[0_0_12px_rgba(239,68,68,0.15)]' :
        isEndingSoon ? 'border-amber-500/40' :
        'border-border'
      }`}>

        {/* Ending soon banner */}
        {canVote && !countdownEnded && isEndingSoon && !isClosing && (
          <div className="flex items-center justify-center gap-2 py-2 px-3 mb-4 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium">
            Ending soon — {countdown} left to vote
          </div>
        )}
        {canVote && !countdownEnded && isClosing && (
          <div className="flex items-center justify-center gap-2 py-2 px-3 mb-4 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium animate-pulse">
            Closing now — {countdown} remaining
          </div>
        )}

        {duel.duelType === 'binary' && (
          <>
            {canVote && !countdownEnded && votedDirection === null && !hasVotedUnknownDir && (
              isClosing ? (
                <div className="text-center py-2 text-sm text-red-400 font-medium">
                  Voting closing soon...
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleBinaryVote(true)}
                    disabled={isAuthenticated && (serviceLoading || !isDeployed || effectiveOnChainId === null)}
                    className="flex-1 py-2.5 text-sm font-medium rounded-lg border-2 border-vote-agree/40 text-vote-agree hover:bg-vote-agree/10 transition-colors disabled:opacity-50"
                  >
                    {agreeLabel}
                  </button>
                  <button
                    onClick={() => handleBinaryVote(false)}
                    disabled={isAuthenticated && (serviceLoading || !isDeployed || effectiveOnChainId === null)}
                    className="flex-1 py-2.5 text-sm font-medium rounded-lg border-2 border-vote-disagree/40 text-vote-disagree hover:bg-vote-disagree/10 transition-colors disabled:opacity-50"
                  >
                    {disagreeLabel}
                  </button>
                </div>
              )
            )}

            {votedDirection !== null && (
              <div className="flex gap-3">
                <div
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border-2 text-center ${
                    votedDirection
                      ? 'border-vote-agree bg-vote-agree/15 text-vote-agree'
                      : 'border-border text-foreground-muted opacity-50'
                  }`}
                >
                  {agreeLabel}
                </div>
                <div
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border-2 text-center ${
                    !votedDirection
                      ? 'border-vote-disagree bg-vote-disagree/15 text-vote-disagree'
                      : 'border-border text-foreground-muted opacity-50'
                  }`}
                >
                  {disagreeLabel}
                </div>
              </div>
            )}

            {hasVotedUnknownDir && votedDirection === null && (
              <div className="text-center py-2 text-sm text-foreground-muted">
                You already voted on this duel
              </div>
            )}

          </>
        )}

        {duel.duelType === 'multi' && displayOptions && (
          <>
            <div className="mb-4">
              <MultiOptionChart
                duelId={duelId}
                createdAt={duel.createdAt}
                endsAt={duel.endsAt}
                options={displayOptions}
                totalVotes={displayTotalVotes}
                isEnded={!canVote}
                chartMode={duel.chartMode || 'top_n'}
                chartTopN={duel.chartTopN || 5}
                refreshKey={refreshKey}
                periodId={activePeriod?.id}
              />
            </div>
            <MultiItemVote
              duelId={duelId}
              options={displayOptions}
              totalVotes={displayTotalVotes}
              isActive={canVote && !isClosing && !countdownEnded && !hasVotedUnknownDir && (!isAuthenticated || (effectiveOnChainId !== null && isDeployed))}
              votedOptionId={votedOptionId}
              createdBy={duel.createdBy}
              onVote={handleOptionVote}
              onOptionAdded={loadDuel}
            />
            {hasVotedUnknownDir && votedOptionId === null && (
              <div className="text-center py-2 text-sm text-foreground-muted mt-2">
                You already voted on this duel
              </div>
            )}
            {canVote && isClosing && !votedOptionId && !hasVotedUnknownDir && (
              <div className="text-center py-2 text-sm text-red-400 font-medium mt-2">
                Voting closing soon...
              </div>
            )}
          </>
        )}

        {duel.duelType === 'level' && displayLevels && (
          <>
            <LevelVote
              levels={displayLevels}
              totalVotes={displayTotalVotes}
              isActive={canVote && !isClosing && !countdownEnded && !hasVotedUnknownDir && (!isAuthenticated || (effectiveOnChainId !== null && isDeployed))}
              votedLevel={votedLevel}
              onVote={handleLevelVote}
            />
            {hasVotedUnknownDir && votedLevel === null && (
              <div className="text-center py-2 text-sm text-foreground-muted mt-2">
                You already voted on this duel
              </div>
            )}
            {canVote && isClosing && !votedLevel && !hasVotedUnknownDir && (
              <div className="text-center py-2 text-sm text-red-400 font-medium mt-2">
                Voting closing soon...
              </div>
            )}
          </>
        )}

        {voteError && (
          <div className="text-center py-2 text-sm text-red-400 font-medium mt-2">
            {voteError}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mt-3 text-xs text-foreground-muted">
          <span>{displayTotalVotes} total votes</span>
          {countdown && canVote && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
              countdownEnded ? 'text-foreground-muted bg-foreground-muted/10' :
              isClosing ? 'text-red-400 bg-red-500/10 font-medium animate-pulse' :
              isEndingSoon ? 'text-amber-400 bg-amber-500/10 font-medium' :
              'text-foreground-secondary bg-surface-hover'
            }`}>
              {!countdownEnded && (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
                </svg>
              )}
              {countdownEnded ? 'Ended' : isClosing || isEndingSoon ? `${countdown} left` : countdown}
            </span>
          )}
        </div>
      </div>

      {/* Mobile: related duels inline section */}
      {duel.categorySlug && (
        <div className="lg:hidden mb-6 mt-6">
          <RelatedDuelsSidebar
            currentDuelId={duelId}
            categorySlug={duel.categorySlug}
            categoryName={duel.categoryName}
            inline
          />
        </div>
      )}

      {/* Comments */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {comments.length} Comment{comments.length !== 1 ? 's' : ''}
          </h3>
          <div className="flex gap-1">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setCommentSort(s.key)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  commentSort === s.key
                    ? 'bg-surface-hover text-foreground'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* New top-level comment */}
        {isAuthenticated && !replyTo && (
          <form className="mb-4" onSubmit={(e) => { e.preventDefault(); handleCreateComment(); }}>
            <div className="flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                maxLength={2000}
                enterKeyHint="send"
                className="flex-1 px-3 py-2 text-base rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent min-h-[44px]"
              />
              <button
                type="submit"
                disabled={!newComment.trim()}
                className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 min-h-[44px] min-w-[60px]"
              >
                Post
              </button>
            </div>
          </form>
        )}

        {/* Threaded comment list */}
        {commentsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-3 py-2 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-3 w-16 bg-surface-hover rounded animate-pulse" />
                  <div className="h-3 w-12 bg-surface-hover rounded animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-3.5 w-full bg-surface-hover rounded animate-pulse" />
                  <div className="h-3.5 w-3/4 bg-surface-hover rounded animate-pulse" />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <div className="h-3 w-6 bg-surface-hover rounded animate-pulse" />
                  <div className="h-3 w-4 bg-surface-hover rounded animate-pulse" />
                  <div className="h-3 w-6 bg-surface-hover rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="space-y-3">
          {buildCommentTree(comments).map((node) => (
            <CommentThread
              key={node.comment.id}
              node={node}
              onVote={handleVoteComment}
              onReply={(id) => setReplyTo(id)}
              onDelete={async (id) => {
                if (!userAddress || !userName) return;
                await deleteComment({ address: userAddress, name: userName }, id);
                loadComments();
              }}
              userAddress={userAddress}
              replyToId={replyTo}
              replyText={newComment}
              onReplyTextChange={setNewComment}
              onSubmitReply={handleCreateComment}
              onCancelReply={() => setReplyTo(null)}
            />
          ))}
        </div>
        )}
      </div>

      {/* Cloaking modal */}
      <VoteCloakingModal
        isOpen={showCloakingModal && votePromise !== null}
        votePromise={votePromise}
        currentPoints={getOptimisticPoints()}
        pointsToAdd={10}
        onComplete={handleModalComplete}
      />
      </div>

      {/* Desktop: sidebar */}
      {duel.categorySlug && (
        <RelatedDuelsSidebar
          currentDuelId={duelId}
          categorySlug={duel.categorySlug}
          categoryName={duel.categoryName}
        />
      )}
    </div>
    </>
  );
}

interface CommentNode {
  comment: Comment;
  children: CommentNode[];
}

function buildCommentTree(comments: Comment[]): CommentNode[] {
  const map = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];

  for (const c of comments) {
    map.set(c.id, { comment: c, children: [] });
  }

  for (const c of comments) {
    const node = map.get(c.id)!;
    if (c.parentId && map.has(c.parentId)) {
      map.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function CommentThread({
  node, onVote, onReply, onDelete, userAddress, depth = 0,
  replyToId, replyText, onReplyTextChange, onSubmitReply, onCancelReply,
}: {
  node: CommentNode;
  onVote: (id: number, dir: 1 | -1 | 0) => void;
  onReply: (id: number) => void;
  onDelete: (id: number) => void;
  userAddress: string | null;
  depth?: number;
  replyToId: number | null;
  replyText: string;
  onReplyTextChange: (v: string) => void;
  onSubmitReply: () => void;
  onCancelReply: () => void;
}) {
  const { comment } = node;
  const score = comment.upvotes - comment.downvotes;
  const isOwn = comment.authorAddress === userAddress;
  const isReplying = replyToId === comment.id;

  return (
    <div className={depth > 0 ? 'ml-5 pl-3 border-l-2 border-border' : ''}>
      <div className="px-3 py-2 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-foreground-muted mb-1">
          <span className="font-medium text-foreground-secondary">{comment.authorName || 'Anon'}</span>
          <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
        </div>
        {comment.isDeleted ? (
          <p className="text-sm text-foreground-muted italic">[deleted]</p>
        ) : (
          <p className="text-sm text-foreground">{comment.body}</p>
        )}
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={() => onVote(comment.id, comment.myVote === 1 ? 0 : 1)}
            className={`min-w-[28px] min-h-[28px] flex items-center justify-center text-xs rounded-md active:bg-surface-hover ${comment.myVote === 1 ? 'text-accent' : 'text-foreground-muted hover:text-foreground'}`}
          >
            ↑
          </button>
          <span className={`text-xs font-medium min-w-[16px] text-center ${score > 0 ? 'text-accent' : score < 0 ? 'text-red-500' : 'text-foreground-muted'}`}>
            {score}
          </span>
          <button
            onClick={() => onVote(comment.id, comment.myVote === -1 ? 0 : -1)}
            className={`min-w-[28px] min-h-[28px] flex items-center justify-center text-xs rounded-md active:bg-surface-hover ${comment.myVote === -1 ? 'text-red-500' : 'text-foreground-muted hover:text-foreground'}`}
          >
            ↓
          </button>
          <button onClick={() => onReply(comment.id)} className="text-xs text-foreground-muted hover:text-accent px-2 min-h-[28px] flex items-center">
            Reply
          </button>
          {isOwn && !comment.isDeleted && (
            <button onClick={() => onDelete(comment.id)} className="text-xs text-foreground-muted hover:text-red-500">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Inline reply input */}
      {isReplying && (
        <form className="ml-3 mt-2 mb-2" onSubmit={(e) => { e.preventDefault(); onSubmitReply(); }}>
          <div className="flex gap-2">
            <input
              autoFocus
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              placeholder={`Reply to ${comment.authorName || 'Anon'}...`}
              maxLength={2000}
              enterKeyHint="send"
              className="flex-1 px-3 py-1.5 text-base rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent min-h-[44px]"
            />
            <button
              type="submit"
              disabled={!replyText.trim()}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
            >
              Reply
            </button>
            <button
              type="button"
              onClick={onCancelReply}
              className="px-2 py-1.5 text-xs text-foreground-muted hover:text-foreground min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Nested replies */}
      {node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <CommentThread
              key={child.comment.id}
              node={child}
              onVote={onVote}
              onReply={onReply}
              onDelete={onDelete}
              userAddress={userAddress}
              depth={depth + 1}
              replyToId={replyToId}
              replyText={replyText}
              onReplyTextChange={onReplyTextChange}
              onSubmitReply={onSubmitReply}
              onCancelReply={onCancelReply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Account deploy banner with proactive on-chain recheck.
 * Polls every 10s so mobile users aren't stuck if the deploy
 * completed but the in-browser confirmation missed it.
 */
function DeployBanner() {
  const walletStatus = useAppStore((s) => s.walletStatus);
  const isError = walletStatus?.includes('timed out') || walletStatus?.includes('error') || walletStatus?.includes('Error');

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        await recheckAccountDeployed();
      } catch {}
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen -mt-6 mb-4">
      <div className="px-4 py-2 bg-accent/10 border-b border-accent/20 flex items-center justify-center gap-2">
        {!isError && (
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        )}
        <span className="text-xs font-medium text-accent">
          {walletStatus || 'Setting up your account...'}
        </span>
        {isError && (
          <button
            onClick={handleRetry}
            className="ml-2 px-2 py-0.5 text-xs font-semibold bg-accent text-white rounded hover:bg-accent/80 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
      {!isError && (
        <div className="h-0.5 bg-surface-hover">
          <div className="h-full bg-accent/60 rounded-r-full animate-pulse" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  );
}
