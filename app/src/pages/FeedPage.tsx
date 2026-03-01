import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/index';
import { fetchFeed } from '@/lib/api/feedClient';
import type { FeedDuel, FeedSort, TopTime } from '@/lib/api/feedClient';
import { DuelFeedCard } from '@/components/feed/DuelFeedCard';
import { SortTabs } from '@/components/feed/SortTabs';
import { Sidebar } from '@/components/feed/Sidebar';
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

export function FeedPage() {
  const { userAddress } = useAppStore();
  const [sort, setSort] = useState<FeedSort>('best');
  const [time, setTime] = useState<TopTime>('all');
  const [duels, setDuels] = useState<FeedDuel[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async (reset = true, silent = false) => {
    if (reset && !silent) {
      setLoading(true);
      setDuels([]);
    } else if (!reset) {
      setLoadingMore(true);
    }
    if (!silent) setError(null);

    try {
      const cursor = reset ? undefined : (nextCursor ?? undefined);
      const result = await fetchFeed({ sort, time, cursor, viewer: userAddress ?? undefined, active: true });
      if (reset) {
        setDuels(result.duels);
      } else {
        setDuels((prev) => [...prev, ...result.duels]);
      }
      setNextCursor(result.nextCursor);
    } catch (err: any) {
      if (!silent) setError(err?.message || 'Failed to load feed');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, time, nextCursor, userAddress]);

  useEffect(() => {
    loadFeed(true);
  }, [sort, time]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply optimistic vote deltas so recently-voted duels show correct counts
  const displayDuels = useMemo(() => applyOptimisticDeltas(duels), [duels]);

  // Periodic silent refresh to keep countdowns synced with server block clock.
  useEffect(() => {
    const interval = setInterval(() => loadFeed(true, true), 60_000);
    return () => clearInterval(interval);
  }, [loadFeed]);

  // Listen for background sync updates and refresh duel data
  useEffect(() => {
    return addSyncListener((cloakAddress, duelId, data) => {
      setDuels((prev) => prev.map((d) => {
        if (d.cloakAddress !== cloakAddress || d.duelId !== duelId) return d;
        if (data.totalVotes >= d.totalVotes) {
          return { ...d, totalVotes: data.totalVotes, agreeVotes: data.agreeVotes, disagreeVotes: data.disagreeVotes, isTallied: data.isTallied };
        }
        return d;
      }));
    });
  }, []);

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
                  <div className="h-2 bg-background-tertiary rounded w-full mb-3" />
                  <div className="h-3 bg-background-tertiary rounded w-1/2" />
                </div>
              ))}
            </motion.div>
          ) : duels.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-card border border-border rounded-md p-8 text-center"
            >
              <p className="text-foreground-muted">No duels found</p>
              <p className="text-xs text-foreground-muted mt-1">
                Be the first to start a community and submit a statement.
              </p>
            </motion.div>
          ) : (
            <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <motion.div
                className="space-y-3"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {displayDuels.map((duel) => (
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sidebar */}
      <Sidebar />
    </div>
  );
}
