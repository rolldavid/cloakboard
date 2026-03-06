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

/** Fire-and-forget: record vote on VoteHistory contract (private, encrypted). */
function recordVoteInBackground(onChainDuelId: number, cloakAddress: string, rawValue: number): void {
  (async () => {
    try {
      const svc = await getOrCreateVoteHistoryService();
      if (!svc) return;
      await svc.recordVoteRaw(onChainDuelId, cloakAddress, rawValue);
    } catch (err: any) {
      console.warn('[VoteHistory] Failed to record:', err?.message);
    }
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
  const [commentSort, setCommentSort] = useState<CommentSort>('best');
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [votedDirection, setVotedDirection] = useState<boolean | null>(null);
  const [votedOptionId, setVotedOptionId] = useState<number | null>(null);
  const [votedLevel, setVotedLevel] = useState<number | null>(null);
  const [showCloakingModal, setShowCloakingModal] = useState(false);
  const [votePromise, setVotePromise] = useState<Promise<void> | null>(null);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
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
  const loadComments = useCallback(async () => {
    if (!duelId) return;
    try {
      const data = await fetchComments({
        duelId,
        sort: commentSort,
        viewer: userAddress || undefined,
        periodId: isRecurring && activePeriod ? activePeriod.id : undefined,
      });
      setComments(data.comments);
    } catch { /* non-fatal */ }
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
    recoverVoteFromHistory();
  }, [duel?.onChainId, duelService, isAuthenticated, userAddress, duelId, recoverVoteFromHistory]);

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
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duelSlug}`);
      navigate('/login');
      return;
    }

    setShowCloakingModal(true);
    setAlreadyVoted(false);
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
        setAlreadyVoted(true);
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setShowCloakingModal(false);
        setVotePromise(null);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        loadDuel(); // Reload fresh from server
      }
    });

    setVotePromise(promise);
  };

  // ─── Multi-item Vote ───
  const handleOptionVote = async (optionId: number) => {
    if (!duel || !duel.options) return;
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
    setAlreadyVoted(false);
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
        setAlreadyVoted(true);
        setVotedOptionId(-1);
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setShowCloakingModal(false);
        setVotePromise(null);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        loadDuel();
      }
    });

    setVotePromise(promise);
  };

  // ─── Level Vote ───
  const handleLevelVote = async (level: number) => {
    if (!duel) return;
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duelSlug}`);
      navigate('/login');
      return;
    }

    setShowCloakingModal(true);
    setAlreadyVoted(false);
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
        setAlreadyVoted(true);
        setVotedLevel(-1);
        recoverVoteFromHistory(1);
      } else {
        console.error('[Vote] Failed:', msg);
        setShowCloakingModal(false);
        setVotePromise(null);
        setVoteError('Vote failed. Please try again.');
        clearOptimisticVote(duelId);
        try { localStorage.removeItem(`duelcloak_voted_lvl_${userAddress}_${voteKeySuffix}`); } catch {}
        loadDuel();
      }
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
      setComments((prev) => [comment, ...prev]);
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
    try {
      const result = await voteComment(
        { address: userAddress, name: userName },
        commentId,
        direction,
      );
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, upvotes: result.upvotes, downvotes: result.downvotes, myVote: result.myVote } : c,
        ),
      );

      // Optimistic points for upvoting (on-chain points only awarded via voting)
      if (direction === 1) {
        const pointsKey = `comment-vote-${commentId}`;
        if (!hasPointsBeenAwarded(pointsKey)) {
          markPointsAwarded(pointsKey);
          addOptimisticPoints(2);
        }
      }
    } catch { /* non-fatal */ }
  };

  const countdownBlock = isRecurring && activePeriod ? activePeriod.endBlock : duel?.endBlock;
  const { timeLeft: countdown, isClosing, hasEnded: countdownEnded } = useCountdown(countdownBlock);

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

  return (
    <>
    {/* Full-width account setup banner — breaks out of max-w container */}
    {isAuthenticated && !isDeployed && canVote && !countdownEnded && (
      <DeployBanner />
    )}
    <div className="flex gap-6 max-w-6xl mx-auto">
      {/* Main content */}
      <div className="flex-1 min-w-0 max-w-3xl">
      {/* Breadcrumb */}
      {(duel.categorySlug || duel.subcategorySlug) && (
      <div className="flex items-center gap-1 text-xs text-foreground-muted mb-4">
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
      )}

      {/* Title + status */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <h1 className="text-xl font-bold text-foreground">{duel.title}</h1>
        <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full font-medium ${
          isActive ? 'bg-vote-agree/20 text-vote-agree' : 'bg-foreground-muted/20 text-foreground-muted'
        }`}>
          {isActive ? 'Active' : 'Ended'}
        </span>
      </div>

      {duel.description && (
        <p className="text-sm text-foreground-secondary mb-6">{duel.description}</p>
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
          />
        </div>
      )}

      {/* Vote section */}
      <div className="bg-surface border border-border rounded-lg p-5 mb-6">

        {duel.duelType === 'binary' && (
          <>
            {canVote && !countdownEnded && votedDirection === null && !alreadyVoted && (
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
                    Agree
                  </button>
                  <button
                    onClick={() => handleBinaryVote(false)}
                    disabled={isAuthenticated && (serviceLoading || !isDeployed || effectiveOnChainId === null)}
                    className="flex-1 py-2.5 text-sm font-medium rounded-lg border-2 border-vote-disagree/40 text-vote-disagree hover:bg-vote-disagree/10 transition-colors disabled:opacity-50"
                  >
                    Disagree
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
                  Agree
                </div>
                <div
                  className={`flex-1 py-2.5 text-sm font-medium rounded-lg border-2 text-center ${
                    !votedDirection
                      ? 'border-vote-disagree bg-vote-disagree/15 text-vote-disagree'
                      : 'border-border text-foreground-muted opacity-50'
                  }`}
                >
                  Disagree
                </div>
              </div>
            )}

            {votedDirection === null && alreadyVoted && (
              <div className="flex gap-3">
                <div className="flex-1 py-2.5 text-sm font-medium rounded-lg border-2 border-border text-foreground-muted text-center opacity-60">
                  Agree
                </div>
                <div className="flex-1 py-2.5 text-sm font-medium rounded-lg border-2 border-border text-foreground-muted text-center opacity-60">
                  Disagree
                </div>
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
              isActive={canVote && !isClosing && !countdownEnded && (!isAuthenticated || (effectiveOnChainId !== null && isDeployed))}
              votedOptionId={votedOptionId}
              createdBy={duel.createdBy}
              onVote={handleOptionVote}
              onOptionAdded={loadDuel}
            />
            {canVote && isClosing && !votedOptionId && (
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
              isActive={canVote && !isClosing && !countdownEnded && (!isAuthenticated || (effectiveOnChainId !== null && isDeployed))}
              votedLevel={votedLevel}
              onVote={handleLevelVote}
            />
            {canVote && isClosing && !votedLevel && (
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

        <div className="text-xs text-foreground-muted mt-3 text-center">
          {displayTotalVotes} total votes
          {countdown && canVote && (
            <span className={isClosing ? 'text-red-400 font-medium' : ''}>
              {' '} · {countdownEnded ? 'Ended' : countdown}
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

        {/* New comment */}
        {isAuthenticated && (
          <div className="mb-4">
            {replyTo && (
              <div className="text-xs text-foreground-muted mb-1">
                Replying to comment #{replyTo}{' '}
                <button onClick={() => setReplyTo(null)} className="text-accent hover:underline">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                maxLength={2000}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCreateComment()}
              />
              <button
                onClick={handleCreateComment}
                disabled={!newComment.trim()}
                className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
              >
                Post
              </button>
            </div>
          </div>
        )}

        {/* Comment list */}
        <div className="space-y-3">
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              onVote={handleVoteComment}
              onReply={(id) => setReplyTo(id)}
              onDelete={async (id) => {
                if (!userAddress || !userName) return;
                await deleteComment({ address: userAddress, name: userName }, id);
                loadComments();
              }}
              isOwn={comment.authorAddress === userAddress}
            />
          ))}
        </div>
      </div>

      {/* Cloaking modal */}
      <VoteCloakingModal
        isOpen={showCloakingModal && votePromise !== null}
        votePromise={votePromise}
        currentPoints={getOptimisticPoints()}
        pointsToAdd={10}
        alreadyVoted={alreadyVoted}
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

function CommentCard({
  comment, onVote, onReply, onDelete, isOwn,
}: {
  comment: Comment;
  onVote: (id: number, dir: 1 | -1 | 0) => void;
  onReply: (id: number) => void;
  onDelete: (id: number) => void;
  isOwn: boolean;
}) {
  const score = comment.upvotes - comment.downvotes;

  return (
    <div className={`px-3 py-2 rounded-lg ${comment.parentId ? 'ml-6 border-l-2 border-border' : ''}`}>
      <div className="flex items-center gap-2 text-xs text-foreground-muted mb-1">
        <span className="font-medium text-foreground-secondary">{comment.authorName || 'Anon'}</span>
        <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
      </div>
      {comment.isDeleted ? (
        <p className="text-sm text-foreground-muted italic">[deleted]</p>
      ) : (
        <p className="text-sm text-foreground">{comment.body}</p>
      )}
      <div className="flex items-center gap-3 mt-1">
        <button
          onClick={() => onVote(comment.id, comment.myVote === 1 ? 0 : 1)}
          className={`text-xs ${comment.myVote === 1 ? 'text-accent' : 'text-foreground-muted hover:text-foreground'}`}
        >
          ↑
        </button>
        <span className={`text-xs font-medium ${score > 0 ? 'text-accent' : score < 0 ? 'text-red-500' : 'text-foreground-muted'}`}>
          {score}
        </span>
        <button
          onClick={() => onVote(comment.id, comment.myVote === -1 ? 0 : -1)}
          className={`text-xs ${comment.myVote === -1 ? 'text-red-500' : 'text-foreground-muted hover:text-foreground'}`}
        >
          ↓
        </button>
        <button onClick={() => onReply(comment.id)} className="text-xs text-foreground-muted hover:text-accent">
          Reply
        </button>
        {isOwn && !comment.isDeleted && (
          <button onClick={() => onDelete(comment.id)} className="text-xs text-foreground-muted hover:text-red-500">
            Delete
          </button>
        )}
      </div>
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
