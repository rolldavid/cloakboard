import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/index';
import { fetchFeed } from '@/lib/api/feedClient';
import type { FeedDuel, FeedSort, TopTime } from '@/lib/api/feedClient';
import { DuelFeedCard } from '@/components/feed/DuelFeedCard';
import { SortTabs } from '@/components/feed/SortTabs';
import { Sidebar } from '@/components/feed/Sidebar';

export function FeedPage() {
  const { userAddress } = useAppStore();
  const [sort, setSort] = useState<FeedSort>('best');
  const [time, setTime] = useState<TopTime>('all');
  const [duels, setDuels] = useState<FeedDuel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      setDuels([]);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const cursor = reset ? undefined : (nextCursor ?? undefined);
      const result = await fetchFeed({ sort, time, cursor, viewer: userAddress ?? undefined });
      if (reset) {
        setDuels(result.duels);
      } else {
        setDuels((prev) => [...prev, ...result.duels]);
      }
      setNextCursor(result.nextCursor);
    } catch (err: any) {
      setError(err?.message || 'Failed to load feed');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, time, nextCursor, userAddress]);

  useEffect(() => {
    loadFeed(true);
  }, [sort, time]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSortChange = (newSort: FeedSort) => {
    setSort(newSort);
    setNextCursor(null);
  };

  const handleTimeChange = (newTime: TopTime) => {
    setTime(newTime);
    setNextCursor(null);
  };

  return (
    <div className="flex gap-6">
      {/* Main feed */}
      <div className="flex-1 min-w-0 space-y-4">
        <SortTabs sort={sort} time={time} onSortChange={handleSortChange} onTimeChange={handleTimeChange} />

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
                <div className="h-2 bg-background-tertiary rounded w-full mb-3" />
                <div className="h-3 bg-background-tertiary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : duels.length === 0 ? (
          <div className="bg-card border border-border rounded-md p-8 text-center">
            <p className="text-foreground-muted">No duels found</p>
            <p className="text-xs text-foreground-muted mt-1">
              Be the first to start a community and submit a statement.
            </p>
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
      <Sidebar />
    </div>
  );
}
