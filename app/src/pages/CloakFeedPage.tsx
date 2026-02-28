import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';

import { useAppStore } from '@/store/index';
import { apiUrl } from '@/lib/api';
import { buildAuthHeaders } from '@/lib/api/authToken';
import {
  fetchFeed, fetchCloakInfo, fetchBans, banMember, unbanMember,
  joinCloak, leaveCloak, fetchRecentCloaks,
  inviteCouncilMember, claimCouncilInvite, declineCouncilInvite,
  fetchCouncilInvites, proposeCouncilRemoval, voteCouncilRemoval,
  fetchCouncilRemovals,
} from '@/lib/api/feedClient';
import type { FeedDuel, FeedSort, TopTime, CloakInfo, BanEntry, CloakSummary, CouncilInvite, RemovalProposal } from '@/lib/api/feedClient';
import { DuelFeedCard } from '@/components/feed/DuelFeedCard';
import { SortTabs } from '@/components/feed/SortTabs';
import { applyOptimisticDeltas, addSyncListener } from '@/lib/voteTracker';

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

export function CloakFeedPage() {
  const { cloakSlug } = useParams<{ cloakSlug: string }>();
  const { userAddress, userName, isAuthenticated } = useAppStore();

  const [sort, setSort] = useState<FeedSort>('best');
  const [time, setTime] = useState<TopTime>('all');
  const [duels, setDuels] = useState<FeedDuel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloakInfo, setCloakInfo] = useState<CloakInfo | null>(null);
  const [cloakName, setCloakName] = useState(cloakSlug || '');

  // Sidebar: recent cloaks for discovery
  const [recentCloaks, setRecentCloaks] = useState<CloakSummary[]>([]);
  useEffect(() => {
    fetchRecentCloaks(10).then(setRecentCloaks).catch(() => {});
  }, []);

  // Admin state
  const [isCouncil, setIsCouncil] = useState(false);
  const [statementText, setStatementText] = useState('');
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [banUsername, setBanUsername] = useState('');
  const [banReason, setBanReason] = useState('');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [showBans, setShowBans] = useState(false);
  const [pendingStatements, setPendingStatements] = useState<{ id: number; text: string; createdAt: string }[]>([]);

  // Council management state
  const [inviteUsername, setInviteUsername] = useState('');
  const [councilInvites, setCouncilInvites] = useState<CouncilInvite[]>([]);
  const [removalProposals, setRemovalProposals] = useState<RemovalProposal[]>([]);
  const [removalConfirmUsername, setRemovalConfirmUsername] = useState<string | null>(null);

  // Resolve cloak address from the first loaded duel or info
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);

  useEffect(() => {
    if (!cloakSlug) return;
    fetchCloakInfo(cloakSlug, userName ?? undefined).then((info) => {
      setCloakInfo(info);
      // Match by username (store's userAddress is a short hash, not the Aztec address in DB)
      if (userName) {
        const member = info.council.find((c) => c.username === userName);
        setIsCouncil(member !== undefined && member.role >= 2);
      }
    }).catch(() => {});
  }, [cloakSlug, userName]);

  const loadPendingStatements = useCallback((addr: string) => {
    fetch(apiUrl(`/api/submit-statement?cloakAddress=${encodeURIComponent(addr)}`))
      .then((r) => r.json())
      .then((data) => setPendingStatements(data.statements || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isCouncil && resolvedAddress) {
      loadPendingStatements(resolvedAddress);
      fetchCouncilInvites(resolvedAddress).then(setCouncilInvites).catch(() => {});
      fetchCouncilRemovals(resolvedAddress, userName ?? undefined).then(setRemovalProposals).catch(() => {});
    }
  }, [isCouncil, resolvedAddress, loadPendingStatements, userName]);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const handleDragStart = useCallback((idx: number) => { setDragIdx(idx); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); }, []);
  const handleDragEnd = useCallback(async () => {
    if (dragIdx === null || dragOverIdx === null || dragIdx === dragOverIdx || !resolvedAddress) {
      setDragIdx(null); setDragOverIdx(null); return;
    }
    const reordered = [...pendingStatements];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dragOverIdx, 0, moved);
    setPendingStatements(reordered);
    setDragIdx(null); setDragOverIdx(null);
    try {
      await fetch(apiUrl('/api/submit-statement/reorder'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloakAddress: resolvedAddress, orderedIds: reordered.map((s) => s.id) }),
      });
    } catch { /* optimistic update already applied */ }
  }, [dragIdx, dragOverIdx, resolvedAddress, pendingStatements]);

  const handleDeleteStatement = useCallback(async (id: number) => {
    if (!resolvedAddress) return;
    setDeleteConfirmId(null);
    setPendingStatements((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(apiUrl(`/api/submit-statement/${id}?cloakAddress=${encodeURIComponent(resolvedAddress)}`), { method: 'DELETE' });
    } catch { /* optimistic update already applied */ }
  }, [resolvedAddress]);

  const loadFeed = useCallback(async (reset = true, silent = false) => {
    if (!cloakSlug) return;
    if (reset && !silent) {
      setLoading(true);
      setDuels([]);
    } else if (!reset) {
      setLoadingMore(true);
    }
    if (!silent) setError(null);
    try {
      const cursor = reset ? undefined : (nextCursor ?? undefined);
      const result = await fetchFeed({ sort, time, cloak: cloakSlug, cursor, viewer: userAddress ?? undefined });
      if (reset) {
        setDuels(result.duels);
      } else {
        setDuels((prev) => [...prev, ...result.duels]);
      }
      setNextCursor(result.nextCursor);
      // Get cloak name and address from first duel
      if (result.duels.length > 0) {
        setCloakName(result.duels[0].cloakName || cloakSlug || '');
        setResolvedAddress(result.duels[0].cloakAddress);
        if (reset) setIsJoined(result.duels[0].isJoinedCloak);
      }
    } catch (err: any) {
      if (!silent) setError(err?.message || 'Failed to load feed');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, time, cloakSlug, nextCursor, userAddress]);

  useEffect(() => {
    loadFeed(true);
  }, [sort, time, cloakSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply optimistic vote deltas so recently-voted duels show correct counts
  const displayDuels = useMemo(() => applyOptimisticDeltas(duels), [duels]);

  // Listen for background sync updates and refresh duel data
  useEffect(() => {
    return addSyncListener((cloakAddress, duelIdVal, data) => {
      setDuels((prev) => prev.map((d) => {
        if (d.cloakAddress !== cloakAddress || d.duelId !== duelIdVal) return d;
        if (data.totalVotes >= d.totalVotes) {
          return { ...d, totalVotes: data.totalVotes, agreeVotes: data.agreeVotes, disagreeVotes: data.disagreeVotes, isTallied: data.isTallied };
        }
        return d;
      }));
    });
  }, []);

  const handleJoinToggle = async () => {
    if (!resolvedAddress || !userAddress || !userName) return;
    const was = isJoined;
    setIsJoined(!was);
    try {
      const user = { address: userAddress, name: userName };
      if (was) {
        await leaveCloak(user, resolvedAddress);
      } else {
        await joinCloak(user, resolvedAddress);
      }
    } catch {
      setIsJoined(was);
    }
  };

  const handleSubmitStatement = async () => {
    if (!statementText.trim() || !resolvedAddress) return;
    setSubmitStatus(null);
    try {
      const res = await fetch(apiUrl('/api/submit-statement'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(userAddress ? { address: userAddress, name: '' } : undefined),
        },
        body: JSON.stringify({ cloakAddress: resolvedAddress, text: statementText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit');
      }
      setStatementText('');
      setSubmitStatus('Statement submitted!');
      loadPendingStatements(resolvedAddress);
      setTimeout(() => setSubmitStatus(null), 3000);
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Submit failed');
    }
  };

  const handleBan = async () => {
    if (!banUsername.trim() || !resolvedAddress || !userAddress || !userName) return;
    try {
      await banMember({ address: userAddress, name: userName }, resolvedAddress, banUsername.trim(), banReason || undefined);
      setBanUsername('');
      setBanReason('');
      setSubmitStatus('User banned');
      setTimeout(() => setSubmitStatus(null), 3000);
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Ban failed');
    }
  };

  const handleLoadBans = async () => {
    if (!resolvedAddress) return;
    setShowBans(!showBans);
    if (!showBans) {
      try {
        const list = await fetchBans(resolvedAddress);
        setBans(list);
      } catch { /* */ }
    }
  };

  const handleUnban = async (username: string) => {
    if (!resolvedAddress || !userAddress || !userName) return;
    try {
      await unbanMember({ address: userAddress, name: userName }, resolvedAddress, username);
      setBans((prev) => prev.filter((b) => b.username !== username));
    } catch { /* */ }
  };

  const handleInviteMember = async () => {
    if (!inviteUsername.trim() || !resolvedAddress || !userAddress || !userName) return;
    try {
      await inviteCouncilMember({ address: userAddress, name: userName }, resolvedAddress, inviteUsername.trim());
      setInviteUsername('');
      setSubmitStatus('Invite sent!');
      fetchCouncilInvites(resolvedAddress).then(setCouncilInvites).catch(() => {});
      setTimeout(() => setSubmitStatus(null), 3000);
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Invite failed');
      setTimeout(() => setSubmitStatus(null), 3000);
    }
  };

  const handleClaimInvite = async () => {
    if (!resolvedAddress || !userAddress || !userName) return;
    try {
      await claimCouncilInvite({ address: userAddress, name: userName }, resolvedAddress);
      // Refresh cloak info to update council list and pendingInvite
      fetchCloakInfo(cloakSlug!, userName).then((info) => {
        setCloakInfo(info);
        const member = info.council.find((c) => c.username === userName);
        setIsCouncil(member !== undefined && member.role >= 2);
      }).catch(() => {});
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Claim failed');
      setTimeout(() => setSubmitStatus(null), 3000);
    }
  };

  const handleDeclineInvite = async () => {
    if (!resolvedAddress || !userAddress || !userName) return;
    try {
      await declineCouncilInvite({ address: userAddress, name: userName }, resolvedAddress);
      setCloakInfo((prev) => prev ? { ...prev, pendingInvite: false } : prev);
    } catch { /* */ }
  };

  const handleProposeRemoval = async (targetUsername: string) => {
    if (!resolvedAddress || !userAddress || !userName) return;
    setRemovalConfirmUsername(null);
    try {
      await proposeCouncilRemoval({ address: userAddress, name: userName }, resolvedAddress, targetUsername);
      setSubmitStatus('Removal proposed');
      fetchCouncilRemovals(resolvedAddress, userName).then(setRemovalProposals).catch(() => {});
      setTimeout(() => setSubmitStatus(null), 3000);
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Proposal failed');
      setTimeout(() => setSubmitStatus(null), 3000);
    }
  };

  const handleRemovalVote = async (removalId: number, vote: boolean) => {
    if (!resolvedAddress || !userAddress || !userName) return;
    try {
      await voteCouncilRemoval({ address: userAddress, name: userName }, resolvedAddress, removalId, vote);
      fetchCouncilRemovals(resolvedAddress, userName).then(setRemovalProposals).catch(() => {});
    } catch (err: any) {
      setSubmitStatus(err?.message || 'Vote failed');
      setTimeout(() => setSubmitStatus(null), 3000);
    }
  };

  // Split duels into active and concluded
  const activeDuels = displayDuels.filter((d) => !d.isTallied && (!d.endTime || new Date(d.endTime).getTime() > Date.now()));
  const concludedDuels = displayDuels.filter((d) => d.isTallied || (d.endTime && new Date(d.endTime).getTime() <= Date.now()));

  // Next duel schedule info
  const nextDuelTime = cloakInfo?.nextDuelAt ? new Date(cloakInfo.nextDuelAt) : null;
  const nextDuelInFuture = nextDuelTime && nextDuelTime.getTime() > Date.now();

  return (
    <div className="flex gap-6">
      {/* Main feed */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/" className="text-sm text-foreground-muted hover:text-foreground transition-colors">
            &larr; All Duels
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">c/{cloakName}</h1>
          {isAuthenticated && resolvedAddress && (
            <button
              onClick={handleJoinToggle}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                isJoined
                  ? 'border border-border text-foreground-muted hover:border-status-error hover:text-status-error'
                  : 'bg-accent hover:bg-accent-hover text-white'
              }`}
            >
              {isJoined ? 'Joined \u2713' : 'Join'}
            </button>
          )}
        </div>

        {/* Council Invite Claim Banner */}
        <AnimatePresence>
          {cloakInfo?.pendingInvite && isAuthenticated && !isCouncil && (
            <motion.div
              initial={{ opacity: 0, y: -20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -20, height: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="bg-accent/10 border border-accent/30 rounded-md p-4 flex items-center justify-between"
            >
              <div>
                <p className="text-sm font-medium text-foreground">You've been invited to join the council</p>
                <p className="text-xs text-foreground-muted mt-0.5">Accept to help manage this community</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={handleDeclineInvite}
                  className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border rounded-md transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={handleClaimInvite}
                  className="px-3 py-1.5 text-xs text-white bg-accent hover:bg-accent-hover rounded-md transition-colors font-medium"
                >
                  Accept
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-status-error/10 border border-status-error/30 rounded-md p-3"
            >
              <p className="text-sm text-status-error">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-md p-4 animate-pulse">
                <div className="h-4 bg-background-tertiary rounded w-1/3 mb-3" />
                <div className="h-5 bg-background-tertiary rounded w-3/4 mb-2" />
                <div className="h-2 bg-background-tertiary rounded w-full" />
              </div>
            ))}
          </motion.div>
        ) : displayDuels.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border rounded-md p-8"
          >
            <p className="text-foreground-muted text-center">No duels in this community yet</p>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            {/* === Featured Active Duel Section === */}
            {activeDuels.length > 0 ? (
              <div className="relative rounded-lg border-2 border-status-success/40 bg-gradient-to-b from-status-success/5 to-transparent p-1">
                <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-status-success" />
                  </span>
                  <h2 className="text-sm font-bold text-status-success uppercase tracking-wider">Active Duel</h2>
                </div>
                {activeDuels.map((duel) => (
                  <DuelFeedCard key={`${duel.cloakAddress}-${duel.duelId}`} duel={duel} />
                ))}
              </div>
            ) : (
              /* No active duel — show schedule or idle state */
              <div className="rounded-lg border border-border bg-card p-5 text-center space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-foreground-muted/40" />
                  <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">No Active Duel</h2>
                </div>
                {nextDuelInFuture ? (
                  <p className="text-sm text-foreground-muted">
                    Next duel starts{' '}
                    <span className="text-foreground font-medium">
                      {nextDuelTime!.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
                      at {nextDuelTime!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-foreground-muted">The next duel will begin when the schedule advances.</p>
                )}
              </div>
            )}

            {/* === Past Duels Feed with Filter === */}
            {concludedDuels.length > 0 && (
              <>
                <div className="flex items-center gap-3 pt-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-foreground-muted font-medium uppercase tracking-wider">Past Duels</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <SortTabs
                  sort={sort}
                  time={time}
                  onSortChange={(s) => { setSort(s); setNextCursor(null); }}
                  onTimeChange={(t) => { setTime(t); setNextCursor(null); }}
                  excludeSorts={['ending_soon']}
                />

                <motion.div
                  className="space-y-3"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {concludedDuels.map((duel) => (
                    <motion.div key={`${duel.cloakAddress}-${duel.duelId}`} variants={cardVariants}>
                      <DuelFeedCard duel={duel} />
                    </motion.div>
                  ))}
                </motion.div>

                {nextCursor && (
                  <div className="text-center pt-2">
                    <button
                      onClick={() => loadFeed(false)}
                      disabled={loadingMore}
                      className="px-4 py-2 bg-card border border-border text-sm text-foreground hover:bg-card-hover rounded-md transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      {/* Sidebar */}
      <div className="hidden lg:block w-72 shrink-0 space-y-4">
        {/* Admin Panel */}
        {isCouncil && isAuthenticated && (
          <div className="bg-card border border-accent/30 rounded-md p-4 space-y-4">
            <h3 className="text-sm font-semibold text-accent">Admin Panel</h3>

            {/* Submit Statement */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground-muted">Submit Statement</label>
              <textarea
                value={statementText}
                onChange={(e) => setStatementText(e.target.value.slice(0, 100))}
                placeholder="Statement text..."
                className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent resize-none"
                rows={2}
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-foreground-muted">{statementText.length}/100</span>
                <button
                  onClick={handleSubmitStatement}
                  disabled={!statementText.trim()}
                  className="px-3 py-1 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>

            {/* Pending Statements */}
            {pendingStatements.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground-muted">Queued ({pendingStatements.length})</label>
                <Reorder.Group
                  axis="y"
                  values={pendingStatements}
                  onReorder={(reordered) => {
                    setPendingStatements(reordered);
                    // Persist reorder to server
                    if (resolvedAddress) {
                      fetch(apiUrl('/api/submit-statement/reorder'), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cloakAddress: resolvedAddress, orderedIds: reordered.map((s) => s.id) }),
                      }).catch(() => {});
                    }
                  }}
                  className="space-y-0.5 max-h-52 overflow-y-auto"
                >
                  {pendingStatements.map((s, i) => (
                    <Reorder.Item
                      key={s.id}
                      value={s}
                      className="group flex items-center gap-1 text-xs rounded px-2 py-1.5 cursor-grab active:cursor-grabbing bg-background-secondary border border-transparent"
                    >
                      <span className="text-foreground-muted shrink-0 w-4 text-right select-none">{i + 1}.</span>
                      <span className="text-foreground flex-1 min-w-0 truncate select-none">{s.text}</span>
                      <button
                        onClick={() => setDeleteConfirmId(s.id)}
                        className="shrink-0 p-0.5 text-foreground-muted hover:text-status-error opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete"
                      >&times;</button>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              </div>
            )}

            {/* Delete confirmation modal */}
            <AnimatePresence>
              {deleteConfirmId !== null && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                  onClick={() => setDeleteConfirmId(null)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    className="bg-card border border-border rounded-lg p-5 max-w-xs w-full mx-4 space-y-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-sm text-foreground font-medium">Delete this statement?</p>
                    <p className="text-xs text-foreground-muted">
                      "{pendingStatements.find((s) => s.id === deleteConfirmId)?.text}"
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border rounded-md transition-colors"
                      >Cancel</button>
                      <button
                        onClick={() => handleDeleteStatement(deleteConfirmId)}
                        className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                      >Delete</button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Ban Member */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground-muted">Ban Member</label>
              <input
                value={banUsername}
                onChange={(e) => setBanUsername(e.target.value)}
                placeholder="Username"
                className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent"
              />
              <textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent resize-none"
                rows={1}
              />
              <button
                onClick={handleBan}
                disabled={!banUsername.trim()}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
              >
                Ban
              </button>
            </div>

            {/* Manage Bans */}
            <div>
              <button
                onClick={handleLoadBans}
                className="text-xs text-accent hover:underline"
              >
                {showBans ? 'Hide' : 'Manage'} Bans
              </button>
              {showBans && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {bans.length === 0 ? (
                    <p className="text-xs text-foreground-muted">No bans</p>
                  ) : (
                    bans.map((ban) => (
                      <div key={ban.userAddress} className="flex items-center justify-between text-xs">
                        <span className="text-foreground">{ban.username}</span>
                        <button
                          onClick={() => handleUnban(ban.username)}
                          className="text-accent hover:underline"
                        >
                          Unban
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Invite Council Member */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground-muted">Invite Council Member</label>
              <div className="flex gap-2">
                <input
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  placeholder="Username"
                  className="flex-1 px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent"
                />
                <button
                  onClick={handleInviteMember}
                  disabled={!inviteUsername.trim()}
                  className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  Invite
                </button>
              </div>
            </div>

            {/* Pending Council Invites */}
            {councilInvites.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground-muted">Pending Invites</label>
                <div className="space-y-1">
                  {councilInvites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-xs bg-background-secondary rounded px-2 py-1.5">
                      <span className="text-foreground">{inv.username}</span>
                      <span className="text-foreground-muted">pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Removal Proposals */}
            {removalProposals.filter((r) => !r.resolved).length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground-muted">Removal Votes</label>
                <div className="space-y-2">
                  {removalProposals.filter((r) => !r.resolved).map((proposal) => {
                    const timeLeft = Math.max(0, new Date(proposal.endsAt).getTime() - Date.now());
                    const hoursLeft = Math.floor(timeLeft / 3600000);
                    const minsLeft = Math.floor((timeLeft % 3600000) / 60000);
                    return (
                      <div key={proposal.id} className="bg-background-secondary rounded p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-foreground font-medium">{proposal.targetUsername || 'Unknown'}</span>
                          <span className="text-xs text-foreground-muted">{hoursLeft}h {minsLeft}m left</span>
                        </div>
                        <div className="text-xs text-foreground-muted">
                          Remove: {proposal.votesFor} / Keep: {proposal.votesAgainst} / {proposal.totalMembers} total
                        </div>
                        {proposal.myVote === null ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRemovalVote(proposal.id, true)}
                              className="flex-1 px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-colors"
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => handleRemovalVote(proposal.id, false)}
                              className="flex-1 px-2 py-1 text-xs bg-status-success/20 text-status-success hover:bg-status-success/30 rounded transition-colors"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-foreground-muted">
                            You voted: {proposal.myVote ? 'remove' : 'keep'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <AnimatePresence>
              {submitStatus && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="text-xs text-status-success"
                >
                  {submitStatus}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Council */}
        {cloakInfo && cloakInfo.council.length > 0 && (
          <div className="bg-card border border-border rounded-md p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Council</h3>
            <ul className="space-y-1.5">
              {cloakInfo.council.map((member) => (
                <li key={member.userAddress} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${member.role >= 3 ? 'bg-accent' : 'bg-foreground-muted'}`} />
                  <Link to={`/u/${member.username || member.userAddress}`} className="text-sm text-foreground hover:text-accent flex-1 min-w-0 truncate">
                    {member.username || `${member.userAddress.slice(0, 8)}...`}
                  </Link>
                  {member.role >= 3 ? (
                    <span className="text-xs text-foreground-muted shrink-0" title="Creator (immune from removal)">creator</span>
                  ) : (
                    <span className="text-xs text-foreground-muted shrink-0">council</span>
                  )}
                  {isCouncil && member.role < 3 && member.username !== userName && member.username && (
                    <button
                      onClick={() => setRemovalConfirmUsername(member.username!)}
                      className="text-foreground-muted hover:text-status-error transition-colors shrink-0"
                      title="Propose removal"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Removal Confirmation Modal */}
        <AnimatePresence>
          {removalConfirmUsername !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              onClick={() => setRemovalConfirmUsername(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="bg-card border border-border rounded-lg p-5 max-w-xs w-full mx-4 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-sm text-foreground font-medium">Propose removing {removalConfirmUsername}?</p>
                <p className="text-xs text-foreground-muted">
                  This starts a 48-hour vote. A majority of council members must vote to remove.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setRemovalConfirmUsername(null)}
                    className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground border border-border rounded-md transition-colors"
                  >Cancel</button>
                  <button
                    onClick={() => handleProposeRemoval(removalConfirmUsername)}
                    className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                  >Propose Removal</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Explore Communities */}
        {recentCloaks.length > 0 && (
          <div className="bg-card border border-border rounded-md p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Explore Communities</h3>
            <ul className="space-y-1.5">
              {recentCloaks.filter((c) => c.slug !== cloakSlug).slice(0, 8).map((c) => (
                <li key={c.address}>
                  <Link
                    to={`/c/${c.slug || c.address}`}
                    className="text-sm text-accent hover:underline"
                  >
                    c/{c.name || c.slug || c.address.slice(0, 10)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
