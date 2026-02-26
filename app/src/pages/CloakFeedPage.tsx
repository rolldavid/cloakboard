import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/store/index';
import { apiUrl } from '@/lib/api';
import {
  fetchFeed, fetchCloakInfo, fetchBans, banMember, unbanMember,
} from '@/lib/api/feedClient';
import type { FeedDuel, FeedSort, TopTime, CloakInfo, BanEntry } from '@/lib/api/feedClient';
import { DuelFeedCard } from '@/components/feed/DuelFeedCard';
import { SortTabs } from '@/components/feed/SortTabs';

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

  // Admin state
  const [isCouncil, setIsCouncil] = useState(false);
  const [statementText, setStatementText] = useState('');
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);
  const [banUsername, setBanUsername] = useState('');
  const [banReason, setBanReason] = useState('');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [showBans, setShowBans] = useState(false);

  // Resolve cloak address from the first loaded duel or info
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!cloakSlug) return;
    fetchCloakInfo(cloakSlug).then((info) => {
      setCloakInfo(info);
      if (userAddress) {
        const member = info.council.find((c) => c.userAddress === userAddress);
        setIsCouncil(member !== undefined && member.role >= 2);
      }
    }).catch(() => {});
  }, [cloakSlug, userAddress]);

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

  // Silent polling after fresh deploy: re-fetch every 3s for 5 minutes
  // Uses silent mode to avoid flashing skeleton loaders on each poll
  const [searchParams] = useSearchParams();
  const isFresh = searchParams.get('fresh') === '1';
  const mountTimeRef = useRef(Date.now());
  const foundDuelsRef = useRef(false);

  useEffect(() => {
    if (!isFresh) return;
    foundDuelsRef.current = false;
    const interval = setInterval(() => {
      const elapsed = Date.now() - mountTimeRef.current;
      // Stop polling after 5 minutes or once we've found duels
      if (elapsed > 300_000 || foundDuelsRef.current) {
        clearInterval(interval);
        return;
      }
      loadFeed(true, true); // silent=true — no skeleton flash
    }, 3_000);
    return () => clearInterval(interval);
  }, [isFresh, cloakSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track when duels arrive to stop polling
  useEffect(() => {
    if (duels.length > 0) foundDuelsRef.current = true;
  }, [duels.length]);

  const handleSubmitStatement = async () => {
    if (!statementText.trim() || !resolvedAddress) return;
    setSubmitStatus(null);
    try {
      const res = await fetch(apiUrl('/api/submit-statement'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userAddress ? { 'x-user-address': userAddress } : {}),
        },
        body: JSON.stringify({ cloakAddress: resolvedAddress, text: statementText.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit');
      }
      setStatementText('');
      setSubmitStatus('Statement submitted!');
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

  return (
    <div className="flex gap-6">
      {/* Main feed */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Link to="/" className="text-sm text-foreground-muted hover:text-foreground transition-colors">
            &larr; All Duels
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-foreground">c/{cloakName}</h1>

        <SortTabs
          sort={sort}
          time={time}
          onSortChange={(s) => { setSort(s); setNextCursor(null); }}
          onTimeChange={(t) => { setTime(t); setNextCursor(null); }}
        />

        {error && (
          <div className="bg-status-error/10 border border-status-error/30 rounded-md p-3">
            <p className="text-sm text-status-error">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-md p-4 animate-pulse">
                <div className="h-4 bg-background-tertiary rounded w-1/3 mb-3" />
                <div className="h-5 bg-background-tertiary rounded w-3/4 mb-2" />
                <div className="h-2 bg-background-tertiary rounded w-full" />
              </div>
            ))}
          </div>
        ) : duels.length === 0 ? (
          <div className="bg-card border border-border rounded-md p-8 text-center">
            {isFresh && !foundDuelsRef.current ? (
              <>
                <div className="flex justify-center mb-4">
                  <div className="relative w-10 h-10">
                    <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
                  </div>
                </div>
                <p className="text-foreground font-medium">Setting up your community</p>
                <p className="text-sm text-foreground-muted mt-2">
                  Your first duel is being prepared on-chain. This page will update automatically once it's live.
                </p>
                <p className="text-xs text-foreground-muted/60 mt-3">
                  This usually takes 2-3 minutes — feel free to check back shortly.
                </p>
              </>
            ) : (
              <p className="text-foreground-muted">No duels in this community yet</p>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {duels.map((duel) => (
                <DuelFeedCard key={`${duel.cloakAddress}-${duel.duelId}`} duel={duel} />
              ))}
            </div>
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

            {submitStatus && (
              <p className="text-xs text-status-success">{submitStatus}</p>
            )}
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
                  <span className="text-sm text-foreground">
                    {member.username || `${member.userAddress.slice(0, 8)}...`}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    {member.role >= 3 ? 'creator' : 'council'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
