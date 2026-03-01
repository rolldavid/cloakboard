import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { useAppStore } from '@/store/index';
import {
  fetchFeed, fetchComments, createComment, deleteComment, voteComment,
  syncDuelVotes, voteDuel,
} from '@/lib/api/feedClient';
import { hasPointsBeenAwarded, markPointsAwarded, addOptimisticPoints, getAwardsSinceConsolidation, resetAwardsSinceConsolidation } from '@/lib/pointsTracker';
import type { FeedDuel, Comment, CommentSort } from '@/lib/api/feedClient';
import { useDuelService } from '@/hooks/useDuelService';
import { VoteChart } from '@/components/duel/VoteChart';
import { VoteCloakingModal } from '@/components/VoteCloakingModal';
import { trackVoteStart, trackVoteConfirmed, getPendingVote, clearVote, startBackgroundSync, addSyncListener } from '@/lib/voteTracker';
import { getAztecClient } from '@/lib/aztec/client';
import { getUserProfileArtifact, getVoteHistoryArtifact } from '@/lib/aztec/contracts';
import { UserProfileService } from '@/lib/aztec/UserProfileService';
import { VoteHistoryService } from '@/lib/aztec/VoteHistoryService';
import { AztecAddress } from '@aztec/aztec.js/addresses';

/** Cached UserProfileService — avoids re-registration + reconnection on every points award. */
let cachedProfileService: UserProfileService | null = null;

async function getOrCreateProfileService(): Promise<UserProfileService | null> {
  if (cachedProfileService) return cachedProfileService;
  const client = getAztecClient();
  if (!client || !client.hasWallet()) return null;
  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) return null;
  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);
  const node = client.getNode();
  if (node) {
    try {
      const instance = await node.getContract(addr);
      if (instance) await wallet.registerContract(instance, artifact);
    } catch { /* already registered */ }
  }
  const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
  await svc.connect(addr, artifact);
  cachedProfileService = svc;
  return svc;
}

/** Fire-and-forget: award whisper points on UserProfile. Cancellable via cancelRef. */
function awardPointsInBackground(amount: number, cancelRef?: { cancelled: boolean }): void {
  (async () => {
    try {
      const svc = await getOrCreateProfileService();
      if (!svc) return;
      if (cancelRef?.cancelled) {
        console.log('[Points] Vote was cancelled, skipping points');
        return;
      }
      // Check consolidation threshold BEFORE incrementing counter
      const awardsSince = getAwardsSinceConsolidation();

      await svc.addPoints(amount);
      addOptimisticPoints(amount);
      console.log(`[Points] Awarded ${amount} whisper points`);

      // Auto-consolidate when note count approaches MAX_NOTES_PER_PAGE (10).
      // Each addPoints creates a new PointNote. Without consolidation,
      // get_my_points (view_notes) silently caps at 10 notes.
      // pop_notes in prove_min_points handles up to 16 notes per call.
      // Delay consolidation to avoid PXE proof contention with addPoints.
      if (awardsSince >= 8) {
        setTimeout(async () => {
          console.log(`[Points] ${awardsSince} awards since last consolidation, consolidating...`);
          try {
            const svc2 = await getOrCreateProfileService();
            if (svc2) {
              await svc2.consolidatePoints();
              resetAwardsSinceConsolidation();
              console.log('[Points] Consolidation tx sent');
            }
          } catch (err: any) {
            console.error('[Points] Consolidation failed:', err?.message);
          }
        }, 15_000); // Wait 15s for addPoints proof to complete before consolidating
      }
    } catch (err: any) {
      console.error('[Points] Background points tx FAILED:', err?.message);
    }
  })();
}

/** Cached VoteHistoryService — avoids re-registration + reconnection on every record call. */
let cachedVoteHistoryService: VoteHistoryService | null = null;

async function getOrCreateVoteHistoryService(): Promise<VoteHistoryService | null> {
  if (cachedVoteHistoryService) return cachedVoteHistoryService;
  const client = getAztecClient();
  if (!client || !client.hasWallet()) return null;
  const vhAddress = (import.meta as any).env?.VITE_VOTE_HISTORY_ADDRESS;
  if (!vhAddress) return null;
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

/** Fire-and-forget: record vote direction on VoteHistory contract. */
function recordVoteInBackground(duelId: number, cloakAddress: string, direction: 'agree' | 'disagree'): void {
  (async () => {
    try {
      const svc = await getOrCreateVoteHistoryService();
      if (!svc) return;
      await svc.recordVote(duelId, cloakAddress, direction);
      console.log(`[VoteHistory] Recorded ${direction} vote for duel ${duelId}`);
    } catch (err: any) {
      console.error('[VoteHistory] Background record tx FAILED:', err?.message);
    }
  })();
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCountdown(ms: number): { h: string; m: string; s: string } | null {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return {
    h: String(h).padStart(2, '0'),
    m: String(m).padStart(2, '0'),
    s: String(s).padStart(2, '0'),
  };
}

function CountdownTimer({ endTime }: { endTime: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(endTime).getTime() - now;
  const cd = formatCountdown(ms);
  if (!cd) return <span className="text-xs text-accent font-medium">Ending soon...</span>;

  return (
    <span className="text-xs text-foreground-muted font-mono tabular-nums">
      {cd.h}:{cd.m}:{cd.s}
    </span>
  );
}

// --- Comment Component ---

interface CommentCardProps {
  comment: Comment;
  depth: number;
  children: Comment[];
  allComments: Comment[];
  onReply: (parentId: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
  onVote: (id: number, direction: 1 | -1 | 0) => void;
  onRequireAuth?: () => void;
}

function CommentCard({ comment, depth, children, allComments, onReply, onDelete, onVote, onRequireAuth }: CommentCardProps) {
  const { userAddress, isAuthenticated } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const score = comment.upvotes - comment.downvotes;
  const isAuthor = userAddress === comment.authorAddress;
  const maxDepth = 6;

  const handleReply = async () => {
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, replyText.trim());
      setReplyText('');
      setShowReply(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVote = (dir: 1 | -1) => {
    if (!isAuthenticated) { onRequireAuth?.(); return; }
    if (comment.myVote === dir) {
      onVote(comment.id, 0); // Toggle off
    } else {
      onVote(comment.id, dir);
    }
  };

  return (
    <div className={`${depth > 0 ? 'ml-4 pl-3 border-l border-border' : ''}`}>
      <div className="py-2">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-foreground-muted hover:text-foreground font-mono"
          >
            [{collapsed ? '+' : '\u2212'}]
          </button>
          <Link to={`/u/${comment.authorName}`} className="font-medium text-foreground hover:text-accent">
            {comment.authorName}
          </Link>
          <span>·</span>
          <span>{timeAgo(comment.createdAt)}</span>
        </div>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Body */}
              <div className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                {comment.isDeleted ? (
                  <span className="italic text-foreground-muted">[deleted]</span>
                ) : (
                  comment.body
                )}
              </div>

              {/* Actions */}
              {!comment.isDeleted && (
                <div className="mt-1.5 flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleVote(1)}
                      className={`hover:text-status-success transition-colors ${comment.myVote === 1 ? 'text-status-success font-bold' : 'text-foreground-muted'}`}
                    >
                      &uarr;
                    </button>
                    <span className={`font-medium ${score > 0 ? 'text-status-success' : score < 0 ? 'text-status-error' : 'text-foreground-muted'}`}>
                      {score > 0 ? `+${score}` : score}
                    </span>
                    <button
                      onClick={() => handleVote(-1)}
                      className={`hover:text-status-error transition-colors ${comment.myVote === -1 ? 'text-status-error font-bold' : 'text-foreground-muted'}`}
                    >
                      &darr;
                    </button>
                  </div>
                  <button
                    onClick={() => isAuthenticated ? setShowReply(!showReply) : onRequireAuth?.()}
                    className="text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Reply
                  </button>
                  {isAuthor && (
                    <button
                      onClick={() => onDelete(comment.id)}
                      className="text-foreground-muted hover:text-status-error transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}

              {/* Reply form */}
              <AnimatePresence>
                {showReply && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="mt-2 space-y-2"
                  >
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value.slice(0, 2000))}
                      placeholder="Write a reply..."
                      autoFocus
                      className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent resize-none"
                      rows={3}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleReply}
                        disabled={!replyText.trim() || submitting}
                        className="px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                      >
                        {submitting ? 'Posting...' : 'Reply'}
                      </button>
                      <button
                        onClick={() => { setShowReply(false); setReplyText(''); }}
                        className="px-3 py-1 text-xs text-foreground-muted hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-foreground-muted ml-auto">{replyText.length}/2000</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Children */}
              {depth < maxDepth && children.length > 0 && (
                <div className="mt-1">
                  {children.map((child) => (
                    <CommentCard
                      key={child.id}
                      comment={child}
                      depth={depth + 1}
                      children={allComments.filter((c) => c.parentId === child.id)}
                      allComments={allComments}
                      onReply={onReply}
                      onDelete={onDelete}
                      onVote={onVote}
                      onRequireAuth={onRequireAuth}
                    />
                  ))}
                </div>
              )}

              {/* Flattened beyond max depth */}
              {depth >= maxDepth && children.length > 0 && (
                <div className="mt-1">
                  {children.map((child) => (
                    <CommentCard
                      key={child.id}
                      comment={child}
                      depth={maxDepth}
                      children={allComments.filter((c) => c.parentId === child.id)}
                      allComments={allComments}
                      onReply={onReply}
                      onDelete={onDelete}
                      onVote={onVote}
                      onRequireAuth={onRequireAuth}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Animated Count Component ---
function AnimatedCount({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 100, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v));

  useEffect(() => { spring.set(value); }, [value, spring]);

  return <motion.span>{display}</motion.span>;
}

// --- Main Page ---

export function DuelDetailPage() {
  const { cloakSlug, duelId: duelIdParam } = useParams<{ cloakSlug: string; duelId: string }>();
  const duelId = parseInt(duelIdParam || '0', 10);
  const { userAddress, userName, isAuthenticated } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

  const requireAuth = useCallback(() => {
    sessionStorage.setItem('returnTo', location.pathname + location.search);
    navigate('/login');
  }, [navigate, location]);

  const [duel, setDuel] = useState<FeedDuel | null>(null);
  const [nextActiveDuel, setNextActiveDuel] = useState<FeedDuel | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [commentSort, setCommentSort] = useState<CommentSort>('top');
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityUp, setQualityUp] = useState(0);
  const [qualityDown, setQualityDown] = useState(0);
  const [myQualityVote, setMyQualityVote] = useState<1 | -1 | null>(null);

  // Aztec voting service
  const { service: duelService, loading: serviceLoading, accountDeploying } = useDuelService(duel?.cloakAddress);

  // Voting state
  const [hasVoted, setHasVoted] = useState(false);
  const [voteDirection, setVoteDirection] = useState<'agree' | 'disagree' | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Cloaking modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [votePromise, setVotePromise] = useState<Promise<void> | null>(null);
  const [currentPoints, setCurrentPoints] = useState(0);
  const [modalAlreadyVoted, setModalAlreadyVoted] = useState(false);

  // Refs
  const handledPendingRef = useRef(false);

  // Reset vote UI state when user changes (logout/login with different account)
  useEffect(() => {
    setHasVoted(false);
    setVoteDirection(null);
    handledPendingRef.current = false;
    // Clear cached services tied to previous wallet
    cachedProfileService = null;
    cachedVoteHistoryService = null;
  }, [userAddress]);

  // Pre-warm whisper points from UserProfile when wallet is ready (unconstrained, fast)
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const svc = await getOrCreateProfileService();
        if (!svc || cancelled) return;
        const points = await svc.getMyPoints();
        if (!cancelled) setCurrentPoints(points);
      } catch { /* wallet not ready or contract unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Query VoteHistory on-chain for permanent vote direction (utility = PXE-local, no proof).
  // Depends on serviceLoading so it retries when the wallet becomes ready (~2s after mount).
  useEffect(() => {
    if (!duel || !isAuthenticated || hasVoted || serviceLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const svc = await getOrCreateVoteHistoryService();
        if (!svc || cancelled) return;
        const dir = await svc.getMyVoteForDuel(duel.duelId, duel.cloakAddress);
        if (dir && !cancelled) {
          setVoteDirection(dir);
          setHasVoted(true);
        }
      } catch (err: any) {
        console.warn('[VoteHistory] Query failed:', err?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [duel, isAuthenticated, hasVoted, serviceLoading]);

  // Module-level background sync — survives component unmount (SPA navigation).
  // Listens for sync results and updates local duel state while mounted.
  const startSyncPolling = useCallback((cloakAddress: string, duelIdVal: number, expectedMin: number) => {
    startBackgroundSync(cloakAddress, duelIdVal, expectedMin, syncDuelVotes);
  }, []);

  // Subscribe to sync updates while mounted — updates duel state from background sync
  useEffect(() => {
    const unsub = addSyncListener((cloakAddress, duelIdVal, data) => {
      setDuel((prev) => {
        if (!prev) return prev;
        if (prev.cloakAddress !== cloakAddress || prev.duelId !== duelIdVal) return prev;
        if (data.totalVotes >= prev.totalVotes) {
          return { ...prev, totalVotes: data.totalVotes, agreeVotes: data.agreeVotes, disagreeVotes: data.disagreeVotes, isTallied: data.isTallied };
        }
        return prev;
      });
    });
    return unsub;
  }, []);

  // Recover in-flight vote state from pending votes (in-memory, short-lived).
  // Permanent direction recovery is handled by VoteHistory on-chain query above.
  useEffect(() => {
    if (!duel || handledPendingRef.current) return;

    const pending = getPendingVote(duel.cloakAddress, duel.duelId);
    if (pending) {
      handledPendingRef.current = true;
      setHasVoted(true);

      // Recover direction from optimistic delta
      const delta = pending.optimisticDelta;
      if (delta) {
        if (delta.agree > 0) setVoteDirection('agree');
        else if (delta.disagree > 0) setVoteDirection('disagree');
      }

      if (pending.status === 'confirmed') {
        const expectedMin = pending.expectedMinVotes ?? (duel.totalVotes + 1);
        if (duel.totalVotes >= expectedMin) {
          clearVote(duel.cloakAddress, duel.duelId);
          return;
        }
        // Apply optimistic delta if server hasn't caught up yet
        if (delta) {
          setDuel((prev) => {
            if (!prev || prev.totalVotes >= expectedMin) return prev;
            return {
              ...prev,
              totalVotes: prev.totalVotes + delta.total,
              agreeVotes: prev.agreeVotes + delta.agree,
              disagreeVotes: prev.disagreeVotes + delta.disagree,
            };
          });
        }
        startSyncPolling(duel.cloakAddress, duel.duelId, expectedMin);
      }
    }
  }, [duel, startSyncPolling]);

  // Load duel — apply optimistic delta inline so server's stale counts
  // don't flash before the pending-vote recovery effect re-applies them.
  const loadDuel = useCallback(async (silent = false) => {
    if (!cloakSlug) return;
    if (!silent) setLoading(true);
    try {
      const result = await fetchFeed({ cloak: cloakSlug, limit: 100, viewer: userAddress ?? undefined });
      let found = result.duels.find((d) => d.duelId === duelId);
      if (found) {
        // Apply optimistic delta from pending vote so we never show stale counts
        const pending = getPendingVote(found.cloakAddress, found.duelId);
        if (pending?.optimisticDelta) {
          const expected = pending.expectedMinVotes ?? (found.totalVotes + pending.optimisticDelta.total);
          if (found.totalVotes < expected) {
            found = {
              ...found,
              totalVotes: found.totalVotes + pending.optimisticDelta.total,
              agreeVotes: found.agreeVotes + pending.optimisticDelta.agree,
              disagreeVotes: found.disagreeVotes + pending.optimisticDelta.disagree,
            };
          }
        }
        setDuel(found);
        if (!silent) {
          setQualityUp(found.qualityUpvotes ?? 0);
          setQualityDown(found.qualityDownvotes ?? 0);
          setMyQualityVote(found.myQualityVote ?? null);
        }
      }
      // Check if there's a newer active duel in this cloak (for "Next Duel" banner)
      const active = result.duels.find((d) => d.duelId !== duelId && !d.isTallied);
      setNextActiveDuel(active ?? null);
    } catch { /* */ }
    if (!silent) setLoading(false);
  }, [cloakSlug, duelId, userAddress]);

  useEffect(() => { loadDuel(); }, [cloakSlug, duelId, userAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic silent refresh to keep countdown synced with server block clock.
  // Faster polling (10s) when endTime has passed (catching the transition).
  useEffect(() => {
    if (!duel) return;
    const ended = !duel.isTallied && duel.endTime && new Date(duel.endTime).getTime() <= Date.now();
    const ms = ended ? 10_000 : 60_000;
    const interval = setInterval(() => loadDuel(true), ms);
    return () => clearInterval(interval);
  }, [duel, loadDuel]);

  // Load comments
  const loadComments = useCallback(async () => {
    if (!duel) return;
    try {
      const result = await fetchComments({
        duelId,
        cloakAddress: duel.cloakAddress,
        sort: commentSort,
        limit: 200,
        viewer: userAddress ?? undefined,
      });
      setComments(result.comments);
      setTotalCount(result.totalCount);
    } catch { /* */ }
  }, [duel, duelId, commentSort, userAddress]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // --- Vote handler ---
  const handleVote = useCallback(async (support: boolean) => {
    if (!duelService || !duel) return;

    setVoteError(null);
    setModalAlreadyVoted(false);
    setHasVoted(true);
    const delta = { total: 1, agree: support ? 1 : 0, disagree: support ? 0 : 1 };
    trackVoteStart(duel.cloakAddress, duel.duelId, delta, duel.totalVotes + 1);

    // Fire points IMMEDIATELY — cancel if vote proof fails.
    // The natural delay from getOrCreateProfileService() setup (~1-2s on first call)
    // gives the vote proof time to fail fast (nullifier collisions fail during simulation).
    const cancelRef = { cancelled: false };
    const pointKey = `duel_vote_zk:${duel.cloakAddress}:${duel.duelId}`;
    if (!hasPointsBeenAwarded(pointKey)) {
      markPointsAwarded(pointKey);
      awardPointsInBackground(10, cancelRef);
    }

    // castVote uses NO_WAIT so it resolves after proof+send (~10-15s),
    // not after mining (~60s). The proof IS the privacy guarantee.
    // Modal waits for proof to complete before transitioning to points phase.
    const promise = duelService.castVote(duel.duelId, support)
      .then(() => {
        const direction = support ? 'agree' as const : 'disagree' as const;
        const delta = { total: 1, agree: support ? 1 : 0, disagree: support ? 0 : 1 };
        trackVoteConfirmed(duel.cloakAddress, duel.duelId, duel.totalVotes + 1, delta);
        setVoteDirection(direction);

        // Update tally — proof is done, tx is sent (NO_WAIT = don't block on mining)
        setDuel((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            totalVotes: prev.totalVotes + 1,
            agreeVotes: prev.agreeVotes + (support ? 1 : 0),
            disagreeVotes: prev.disagreeVotes + (support ? 0 : 1),
          };
        });

        // Record vote on-chain privately (background, NO_WAIT)
        recordVoteInBackground(duel.duelId, duel.cloakAddress, support ? 'agree' : 'disagree');

        // Start sync polling: fires immediately (server retries 8x5s=40s on first call),
        // then polls every 15s for up to 3 min. Survives page reload via voteTracker localStorage.
        startSyncPolling(duel.cloakAddress, duel.duelId, duel.totalVotes + 1);
      })
      .catch((err: any) => {
        cancelRef.cancelled = true; // Cancel points if vote failed
        const msg = err?.message ?? '';
        if (msg.includes('uninitialized PublicImmutable')) {
          // Account contract not deployed yet — user needs to wait
          setHasVoted(false);
          setVoteDirection(null);
          setVoteError('Your account is still being set up. Please wait a moment and try again.');
          clearVote(duel.cloakAddress, duel.duelId);
        } else if (msg.includes('nullifier') || msg.includes('already')) {
          setModalAlreadyVoted(true);
          setVoteError('You have already voted on this duel.');
        } else {
          setHasVoted(false);
          setVoteDirection(null);
          setVoteError(msg || 'Vote failed -- please try again');
          clearVote(duel.cloakAddress, duel.duelId);
        }
      });

    setVotePromise(promise);
    setModalOpen(true);
  }, [duelService, duel, startSyncPolling]);

  const handleModalComplete = useCallback(() => {
    setModalOpen(false);
    setVotePromise(null);
    setModalAlreadyVoted(false);
  }, []);

  const handlePostComment = async () => {
    if (!commentText.trim() || posting || !duel || !userAddress || !userName) return;
    setPosting(true);
    setError(null);
    try {
      const newComment = await createComment(
        { address: userAddress, name: userName },
        { duelId, cloakAddress: duel.cloakAddress, body: commentText.trim() },
      );
      setComments((prev) => [newComment, ...prev]);
      setTotalCount((c) => c + 1);
      setCommentText('');

      // Award 1 on-chain point for commenting
      const pointKey = `comment:${newComment.id}`;
      if (!hasPointsBeenAwarded(pointKey)) {
        markPointsAwarded(pointKey);
        awardPointsInBackground(1);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  };

  const handleReply = async (parentId: number, body: string) => {
    if (!duel || !userAddress || !userName) return;
    const newComment = await createComment(
      { address: userAddress, name: userName },
      { duelId, cloakAddress: duel.cloakAddress, parentId, body },
    );
    setComments((prev) => [...prev, newComment]);
    setTotalCount((c) => c + 1);

    // Award 1 on-chain point for replying
    const pointKey = `comment:${newComment.id}`;
    if (!hasPointsBeenAwarded(pointKey)) {
      markPointsAwarded(pointKey);
      awardPointsInBackground(1);
    }
  };

  const handleDelete = async (commentId: number) => {
    if (!userAddress || !userName) return;
    // Optimistic
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, isDeleted: true, body: '' } : c)),
    );
    try {
      await deleteComment({ address: userAddress, name: userName }, commentId);
    } catch {
      // Revert — reload
      loadComments();
    }
  };

  const handleVoteComment = async (commentId: number, direction: 1 | -1 | 0) => {
    if (!userAddress || !userName) return;
    // Optimistic update
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        let upvotes = c.upvotes;
        let downvotes = c.downvotes;
        // Undo old vote
        if (c.myVote === 1) upvotes--;
        if (c.myVote === -1) downvotes--;
        // Apply new
        const newVote = c.myVote === direction ? null : (direction === 0 ? null : direction);
        if (newVote === 1) upvotes++;
        if (newVote === -1) downvotes++;
        return { ...c, upvotes, downvotes, myVote: newVote as 1 | -1 | null, score: upvotes - downvotes };
      }),
    );
    try {
      const result = await voteComment({ address: userAddress, name: userName }, commentId, direction);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, upvotes: result.upvotes, downvotes: result.downvotes, myVote: result.myVote, score: result.upvotes - result.downvotes } : c,
        ),
      );

      // Award 1 on-chain point for comment voting (first time only per comment)
      const pointKey = `comment_vote:${commentId}`;
      if (!hasPointsBeenAwarded(pointKey)) {
        markPointsAwarded(pointKey);
        awardPointsInBackground(1);
      }
    } catch {
      loadComments();
    }
  };

  const handleQualityVote = async (dir: 1 | -1) => {
    if (!isAuthenticated) { requireAuth(); return; }
    if (!duel || !userAddress || !userName) return;

    const oldVote = myQualityVote;
    const oldUp = qualityUp;
    const oldDown = qualityDown;

    // Optimistic update
    const newVote = oldVote === dir ? null : dir;
    let newUp = oldUp;
    let newDown = oldDown;
    if (oldVote === 1) newUp--;
    if (oldVote === -1) newDown--;
    if (newVote === 1) newUp++;
    if (newVote === -1) newDown++;

    setMyQualityVote(newVote);
    setQualityUp(newUp);
    setQualityDown(newDown);

    try {
      const result = await voteDuel(
        { address: userAddress, name: userName },
        duel.cloakAddress,
        duel.duelId,
        oldVote === dir ? 0 : dir,
      );
      setQualityUp(result.qualityUpvotes);
      setQualityDown(result.qualityDownvotes);
      setMyQualityVote(result.myVote);

      // Award 1 on-chain point (first time only)
      const pointKey = `duel_vote:${duel.cloakAddress}:${duel.duelId}`;
      if (!hasPointsBeenAwarded(pointKey)) {
        markPointsAwarded(pointKey);
        awardPointsInBackground(1);
      }
    } catch {
      setMyQualityVote(oldVote);
      setQualityUp(oldUp);
      setQualityDown(oldDown);
    }
  };

  // Build comment tree
  const topLevelComments = comments.filter((c) => c.parentId === null);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="space-y-4"
      >
        <div className="bg-card border border-border rounded-md p-6 animate-pulse">
          <div className="h-6 bg-background-tertiary rounded w-1/3 mb-4" />
          <div className="h-8 bg-background-tertiary rounded w-3/4 mx-auto mb-4" />
          <div className="h-3 bg-background-tertiary rounded w-1/4 mx-auto" />
        </div>
      </motion.div>
    );
  }

  if (!duel) {
    return (
      <div className="bg-card border border-border rounded-md p-8 text-center">
        <p className="text-foreground-muted">Duel not found</p>
        <Link to="/" className="text-sm text-accent hover:underline mt-2 inline-block">Back to feed</Link>
      </div>
    );
  }

  const isActive = !duel.isTallied;
  const statementText = duel.statementText?.replace(/\0/g, '').trim() || '(No statement)';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Vote Cloaking Modal */}
      <VoteCloakingModal
        isOpen={modalOpen}
        votePromise={votePromise}
        currentPoints={currentPoints}
        pointsToAdd={10}
        onComplete={handleModalComplete}
        alreadyVoted={modalAlreadyVoted}
      />

      {/* Back nav */}
      <Link
        to={`/c/${cloakSlug}`}
        className="text-sm text-accent hover:underline"
      >
        &larr; c/{duel.cloakName || cloakSlug}
      </Link>

      {/* Duel Card */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-6 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isActive ? 'bg-status-success/10 text-status-success' : 'bg-foreground-muted/10 text-foreground-muted'}`}>
              {isActive ? 'ACTIVE' : 'CONCLUDED'}
            </span>
            {isActive && duel.endTime && <CountdownTimer endTime={duel.endTime} />}
            <span className="text-sm text-foreground-muted">Duel #{duel.duelId}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => handleQualityVote(1)}
                className={`hover:text-status-success transition-colors ${myQualityVote === 1 ? 'text-status-success font-bold' : 'text-foreground-muted'}`}
              >
                &uarr;
              </button>
              <span className={`font-medium ${(qualityUp - qualityDown) > 0 ? 'text-status-success' : (qualityUp - qualityDown) < 0 ? 'text-status-error' : 'text-foreground-muted'}`}>
                {(qualityUp - qualityDown) > 0 ? `+${qualityUp - qualityDown}` : qualityUp - qualityDown}
              </span>
              <button
                onClick={() => handleQualityVote(-1)}
                className={`hover:text-status-error transition-colors ${myQualityVote === -1 ? 'text-status-error font-bold' : 'text-foreground-muted'}`}
              >
                &darr;
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-8 text-center">
          <p className="text-2xl font-bold text-foreground leading-relaxed">
            {statementText}
          </p>
        </div>

        {/* Vote timeline chart */}
        <div className="px-6 pb-2">
          <VoteChart
            cloakAddress={duel.cloakAddress}
            duelId={duel.duelId}
            createdAt={duel.createdAt}
            agreeVotes={duel.agreeVotes}
            disagreeVotes={duel.disagreeVotes}
            totalVotes={duel.totalVotes}
            isTallied={duel.isTallied}
            refreshKey={duel.totalVotes}
          />
        </div>

        {/* Vote buttons — three states: active (clickable), selected (highlighted), unselected (muted) */}
        {isActive && (
          <div className="px-6 py-4">
            {isAuthenticated && !hasVoted && (serviceLoading || accountDeploying) ? (
              <p className="text-sm text-foreground-muted text-center flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {accountDeploying ? 'Setting up your account for voting...' : 'Connecting to Aztec for voting...'}
              </p>
            ) : (
              <div className="flex gap-3 justify-center">
                <motion.button
                  whileTap={!hasVoted ? { scale: 0.96 } : undefined}
                  animate={
                    hasVoted && voteDirection === 'agree'
                      ? { scale: [1, 1.05, 1], transition: { duration: 0.3 } }
                      : {}
                  }
                  disabled={isAuthenticated && (hasVoted || !duelService || accountDeploying)}
                  onClick={() => isAuthenticated ? handleVote(true) : requireAuth()}
                  className={`flex-1 max-w-[200px] py-3 font-semibold rounded-md transition-colors ${
                    hasVoted
                      ? voteDirection === 'agree'
                        ? 'bg-status-success/20 border-2 border-status-success text-status-success cursor-default'
                        : 'bg-status-success/5 border border-status-success/20 text-status-success/40 cursor-default'
                      : 'bg-status-success/10 border border-status-success/30 text-status-success hover:bg-status-success/20 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {hasVoted && voteDirection === 'agree' ? '\u2713 Agree' : 'Agree'}
                </motion.button>
                <motion.button
                  whileTap={!hasVoted ? { scale: 0.96 } : undefined}
                  animate={
                    hasVoted && voteDirection === 'disagree'
                      ? { scale: [1, 1.05, 1], transition: { duration: 0.3 } }
                      : {}
                  }
                  disabled={isAuthenticated && (hasVoted || !duelService || accountDeploying)}
                  onClick={() => isAuthenticated ? handleVote(false) : requireAuth()}
                  className={`flex-1 max-w-[200px] py-3 font-semibold rounded-md transition-colors ${
                    hasVoted
                      ? voteDirection === 'disagree'
                        ? 'bg-status-error/20 border-2 border-status-error text-status-error cursor-default'
                        : 'bg-status-error/5 border border-status-error/20 text-status-error/40 cursor-default'
                      : 'bg-status-error/10 border border-status-error/30 text-status-error hover:bg-status-error/20 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                >
                  {hasVoted && voteDirection === 'disagree' ? '\u2713 Disagree' : 'Disagree'}
                </motion.button>
              </div>
            )}
          </div>
        )}

        <AnimatePresence>
          {voteError && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2 }}
              className="px-6 pb-4"
            >
              <p className="text-sm text-status-error text-center">{voteError}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agree/disagree counts (only when active) */}
        {duel.totalVotes > 0 && isActive && (
          <div className="px-6 pb-4 flex justify-center gap-6 text-sm">
            <span className="text-status-success font-medium">Agree: <AnimatedCount value={duel.agreeVotes} /></span>
            <span className="text-status-error font-medium">Disagree: <AnimatedCount value={duel.disagreeVotes} /></span>
          </div>
        )}

        {/* Final outcome for concluded duels */}
        {!isActive && duel.totalVotes > 0 && (() => {
          const agreePercent = Math.round((duel.agreeVotes / duel.totalVotes) * 100);
          const disagreePercent = 100 - agreePercent;
          const winner = agreePercent > disagreePercent ? 'Agree' : agreePercent < disagreePercent ? 'Disagree' : 'Tie';
          return (
            <div className="px-6 pb-4 space-y-3">
              <div className="bg-background-secondary rounded-md p-4 text-center space-y-2">
                <p className="text-xs text-foreground-muted font-medium uppercase tracking-wider">Final Result</p>
                <p className="text-lg font-bold text-foreground">
                  {winner === 'Tie' ? 'Tied' : `${winner} wins`} — {duel.totalVotes} votes
                </p>
                <div className="h-2.5 bg-background-tertiary rounded-full overflow-hidden flex">
                  <div className="bg-status-success transition-all duration-300" style={{ width: `${agreePercent}%` }} />
                  <div className="bg-status-error transition-all duration-300" style={{ width: `${disagreePercent}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-status-success font-medium">{agreePercent}% Agree ({duel.agreeVotes})</span>
                  <span className="text-status-error font-medium">{disagreePercent}% Disagree ({duel.disagreeVotes})</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Next Duel Banner — shown when this duel is concluded and a new active duel exists */}
        {!isActive && nextActiveDuel && (
          <div
            onClick={() => navigate(`/d/${nextActiveDuel.cloakSlug || nextActiveDuel.cloakAddress}/${nextActiveDuel.duelId}`)}
            className="mx-6 mb-4 p-3 bg-accent/10 border border-accent/30 rounded-md flex items-center justify-between cursor-pointer hover:bg-accent/15 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-status-success" />
              </span>
              <span className="text-sm font-medium text-foreground">Next duel is active</span>
            </div>
            <span className="text-sm text-accent font-medium">View &rarr;</span>
          </div>
        )}
      </div>

      {/* Comments Section */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        {/* Comment header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{totalCount} Comments</span>
          <div className="flex gap-1">
            {(['top', 'new', 'controversial', 'old'] as CommentSort[]).map((s) => (
              <button
                key={s}
                onClick={() => setCommentSort(s)}
                className={`relative px-2 py-1 text-xs font-medium rounded transition-colors ${
                  commentSort === s
                    ? 'text-accent'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {commentSort === s && (
                  <motion.div
                    layoutId="comment-sort-indicator"
                    className="absolute inset-0 bg-accent/10 rounded"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* New comment form */}
        {isAuthenticated ? (
          <div className="px-4 py-3 border-b border-border space-y-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value.slice(0, 2000))}
              placeholder="Share your thoughts..."
              className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent resize-none"
              rows={3}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground-muted">{commentText.length}/2000</span>
              <button
                onClick={handlePostComment}
                disabled={!commentText.trim() || posting}
                className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 border-b border-border">
            <button
              onClick={requireAuth}
              className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground-muted hover:border-accent hover:text-foreground transition-colors text-left"
            >
              Share your thoughts...
            </button>
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2 }}
              className="px-4 py-2 bg-status-error/10"
            >
              <p className="text-xs text-status-error">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Comment threads */}
        <div className="px-4 py-2">
          {topLevelComments.length === 0 ? (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm text-foreground-muted text-center py-6"
            >
              No comments yet. Be the first!
            </motion.p>
          ) : (
            topLevelComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                depth={0}
                children={comments.filter((c) => c.parentId === comment.id)}
                allComments={comments}
                onReply={handleReply}
                onDelete={handleDelete}
                onVote={handleVoteComment}
                onRequireAuth={requireAuth}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
