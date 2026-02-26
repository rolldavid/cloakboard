import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import {
  fetchFeed, fetchComments, createComment, deleteComment, voteComment,
  starDuel, unstarDuel, syncDuelVotes,
} from '@/lib/api/feedClient';
import type { FeedDuel, Comment, CommentSort } from '@/lib/api/feedClient';
import { useDuelService } from '@/hooks/useDuelService';
import { VoteChart } from '@/components/duel/VoteChart';
import { VoteCloakingModal } from '@/components/VoteCloakingModal';
import { trackVoteStart, trackVoteConfirmed, getPendingVote, clearVote } from '@/lib/voteTracker';
import { getAztecClient } from '@/lib/aztec/client';
import { getUserProfileArtifact } from '@/lib/aztec/contracts';
import { UserProfileService } from '@/lib/aztec/UserProfileService';
import { AztecAddress } from '@aztec/aztec.js/addresses';

/** Fire-and-forget: award whisper points on UserProfile after vote confirms. */
function awardPointsInBackground(amount: number): void {
  (async () => {
    try {
      // Small delay to let the vote's IVC proof worker finish cleanly
      await new Promise(r => setTimeout(r, 2000));

      const client = getAztecClient();
      if (!client || !client.hasWallet()) {
        console.warn('[Points] No wallet available, skipping points award');
        return;
      }
      const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
      if (!profileAddress) {
        console.warn('[Points] VITE_USER_PROFILE_ADDRESS not set, skipping');
        return;
      }
      const wallet = client.getWallet();
      const senderAddress = client.getAddress() ?? undefined;
      const paymentMethod = client.getPaymentMethod();
      const artifact = await getUserProfileArtifact();
      const addr = AztecAddress.fromString(profileAddress);

      // Register contract instance with wallet (required for Contract.at)
      const node = client.getNode();
      if (node) {
        try {
          const instance = await node.getContract(addr);
          if (instance) {
            await wallet.registerContract(instance, artifact);
            console.log('[Points] UserProfile contract registered with wallet');
          } else {
            console.warn('[Points] UserProfile instance not found on node — contract may not be deployed');
          }
        } catch (regErr: any) {
          // TransactionInactiveError is expected if already registered
          const msg = regErr?.message ?? '';
          if (!msg.includes('already') && !msg.includes('TransactionInactive')) {
            console.warn('[Points] Contract registration error:', msg);
          }
        }
      } else {
        console.warn('[Points] No node available for contract registration');
      }

      console.log('[Points] Connecting to UserProfile...');
      const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
      await svc.connect(addr, artifact);
      console.log('[Points] Sending add_points tx (IVC proof required)...');
      await svc.addPoints(amount);
      console.log(`[Points] Successfully awarded ${amount} whisper points`);
    } catch (err: any) {
      console.error('[Points] Background points tx FAILED:', err?.message, err?.stack?.slice(0, 300));
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

// --- Comment Component ---

interface CommentCardProps {
  comment: Comment;
  depth: number;
  children: Comment[];
  allComments: Comment[];
  onReply: (parentId: number, body: string) => Promise<void>;
  onDelete: (id: number) => void;
  onVote: (id: number, direction: 1 | -1 | 0) => void;
}

function CommentCard({ comment, depth, children, allComments, onReply, onDelete, onVote }: CommentCardProps) {
  const { userAddress } = useAppStore();
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

        {!collapsed && (
          <>
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
                  onClick={() => setShowReply(!showReply)}
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
            {showReply && (
              <div className="mt-2 space-y-2">
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
              </div>
            )}

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
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export function DuelDetailPage() {
  const { cloakSlug, duelId: duelIdParam } = useParams<{ cloakSlug: string; duelId: string }>();
  const duelId = parseInt(duelIdParam || '0', 10);
  const { userAddress, userName, isAuthenticated } = useAppStore();

  const [duel, setDuel] = useState<FeedDuel | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [commentSort, setCommentSort] = useState<CommentSort>('top');
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);

  // Aztec voting service
  const { service: duelService, loading: serviceLoading } = useDuelService(duel?.cloakAddress);

  // Voting state
  const [hasVoted, setHasVoted] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  // Cloaking modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [votePromise, setVotePromise] = useState<Promise<void> | null>(null);
  const [currentPoints, setCurrentPoints] = useState(0);
  const [modalAlreadyVoted, setModalAlreadyVoted] = useState(false);

  // Pre-warm whisper points from UserProfile when wallet is ready (unconstrained, fast)
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const client = getAztecClient();
        if (!client || !client.hasWallet()) return;
        const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
        if (!profileAddress) return;
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
          } catch { /* may already be registered */ }
        }
        const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
        await svc.connect(addr, artifact);
        const points = await svc.getMyPoints();
        if (!cancelled) setCurrentPoints(points);
      } catch { /* wallet not ready or contract unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Check for pending votes on mount (from voteTracker)
  useEffect(() => {
    if (!duel) return;
    const pending = getPendingVote(duel.cloakAddress, duel.duelId);
    if (pending) {
      setHasVoted(true);
      if (pending.status === 'confirmed') {
        // Vote was confirmed before navigation — trigger sync
        clearVote(duel.cloakAddress, duel.duelId);
        syncDuelVotes(duel.cloakAddress, duel.duelId, duel.totalVotes + 1)
          .then((synced) => {
            setDuel((prev) => prev ? { ...prev, totalVotes: synced.totalVotes, agreeVotes: synced.agreeVotes, disagreeVotes: synced.disagreeVotes, isTallied: synced.isTallied } : prev);
          })
          .catch((err: any) => console.warn('[DuelDetail] Sync failed:', err?.message));
      }
    }
  }, [duel]);

  // Load duel
  useEffect(() => {
    if (!cloakSlug) return;
    setLoading(true);
    fetchFeed({ cloak: cloakSlug, viewer: userAddress ?? undefined })
      .then((result) => {
        const found = result.duels.find((d) => d.duelId === duelId);
        if (found) {
          setDuel(found);
          setStarred(found.isStarred);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cloakSlug, duelId, userAddress]);

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
    trackVoteStart(duel.cloakAddress, duel.duelId);

    // Optimistic tally update
    setDuel((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        totalVotes: prev.totalVotes + 1,
        agreeVotes: prev.agreeVotes + (support ? 1 : 0),
        disagreeVotes: prev.disagreeVotes + (support ? 0 : 1),
      };
    });

    // Show modal immediately — no blocking pre-check
    // castVote uses NO_WAIT so it resolves after proof+send (~10-15s),
    // not after mining (~60s). The proof IS the privacy guarantee.
    const promise = duelService.castVote(duel.duelId, support)
      .then(() => {
        trackVoteConfirmed(duel.cloakAddress, duel.duelId);

        // Background tx: award 10 whisper points on UserProfile (fire-and-forget)
        awardPointsInBackground(10);

        // Anonymous sync after random delay (1-5s) to reduce timing correlation
        const delay = 1000 + Math.random() * 4000;
        setTimeout(() => {
          syncDuelVotes(duel.cloakAddress, duel.duelId, duel.totalVotes + 1)
            .then((synced) => {
              setDuel((prev) => prev ? { ...prev, totalVotes: synced.totalVotes, agreeVotes: synced.agreeVotes, disagreeVotes: synced.disagreeVotes, isTallied: synced.isTallied } : prev);
            })
            .catch((err: any) => console.warn('[DuelDetail] Sync failed:', err?.message));
        }, delay);
      })
      .catch((err: any) => {
        const msg = err?.message ?? '';
        if (msg.includes('nullifier') || msg.includes('already')) {
          setModalAlreadyVoted(true);
          setVoteError('You have already voted on this duel.');
        } else {
          setHasVoted(false);
          // Revert optimistic update
          setDuel((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              totalVotes: prev.totalVotes - 1,
              agreeVotes: prev.agreeVotes - (support ? 1 : 0),
              disagreeVotes: prev.disagreeVotes - (support ? 0 : 1),
            };
          });
          setVoteError(msg || 'Vote failed -- please try again');
          clearVote(duel.cloakAddress, duel.duelId);
        }
      });

    setVotePromise(promise);
    setModalOpen(true);
  }, [duelService, duel]);

  const handleModalComplete = useCallback(() => {
    setModalOpen(false);
    setVotePromise(null);
    setModalAlreadyVoted(false);
    if (duel) clearVote(duel.cloakAddress, duel.duelId);
  }, [duel]);

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
    } catch {
      loadComments();
    }
  };

  const handleStarToggle = async () => {
    if (!duel || !userAddress || !userName) return;
    const was = starred;
    setStarred(!was);
    try {
      const user = { address: userAddress, name: userName };
      if (was) {
        await unstarDuel(user, duel.cloakAddress, duel.duelId);
      } else {
        await starDuel(user, duel.cloakAddress, duel.duelId);
      }
    } catch {
      setStarred(was);
    }
  };

  // Build comment tree
  const topLevelComments = comments.filter((c) => c.parentId === null);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-md p-6 animate-pulse">
          <div className="h-6 bg-background-tertiary rounded w-1/3 mb-4" />
          <div className="h-8 bg-background-tertiary rounded w-3/4 mx-auto mb-4" />
          <div className="h-3 bg-background-tertiary rounded w-1/4 mx-auto" />
        </div>
      </div>
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
              {isActive ? 'ACTIVE' : 'ENDED'}
            </span>
            <span className="text-sm text-foreground-muted">Duel #{duel.duelId}</span>
          </div>
          <button
            onClick={handleStarToggle}
            className={`text-lg hover:text-accent transition-colors ${starred ? 'text-accent' : 'text-foreground-muted'}`}
          >
            {starred ? '\u2605' : '\u2606'}
          </button>
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
          />
        </div>

        {/* Vote buttons */}
        {isActive && isAuthenticated && !hasVoted && (
          <div className="px-6 py-4">
            {serviceLoading ? (
              <p className="text-sm text-foreground-muted text-center flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Connecting to Aztec for voting...
              </p>
            ) : (
              <div className="flex gap-3 justify-center">
                <button
                  disabled={!duelService}
                  onClick={() => handleVote(true)}
                  className="flex-1 max-w-[200px] py-3 bg-status-success/10 border border-status-success/30 text-status-success font-semibold rounded-md hover:bg-status-success/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Agree
                </button>
                <button
                  disabled={!duelService}
                  onClick={() => handleVote(false)}
                  className="flex-1 max-w-[200px] py-3 bg-status-error/10 border border-status-error/30 text-status-error font-semibold rounded-md hover:bg-status-error/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Disagree
                </button>
              </div>
            )}
          </div>
        )}

        {hasVoted && !modalOpen && (
          <div className="px-6 pb-4 text-center">
            <p className="text-sm text-status-success font-medium">Vote confirmed on-chain</p>
          </div>
        )}

        {voteError && (
          <div className="px-6 pb-4">
            <p className="text-sm text-status-error text-center">{voteError}</p>
          </div>
        )}

        {/* Agree/disagree counts (only when active — outcome box shows when ended) */}
        {duel.totalVotes > 0 && !duel.isTallied && (
          <div className="px-6 pb-4 flex justify-center gap-6 text-sm">
            <span className="text-status-success font-medium">Agree: {duel.agreeVotes}</span>
            <span className="text-status-error font-medium">Disagree: {duel.disagreeVotes}</span>
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
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  commentSort === s
                    ? 'bg-accent/10 text-accent'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* New comment form */}
        {isAuthenticated && (
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
        )}

        {error && (
          <div className="px-4 py-2 bg-status-error/10">
            <p className="text-xs text-status-error">{error}</p>
          </div>
        )}

        {/* Comment threads */}
        <div className="px-4 py-2">
          {topLevelComments.length === 0 ? (
            <p className="text-sm text-foreground-muted text-center py-6">No comments yet. Be the first!</p>
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
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
