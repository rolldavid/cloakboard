import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrendingDuels, fetchRecentlyEndedDuels, type TrendingDuel, type RecentlyEndedDuel } from '@/lib/api/duelClient';
import { motion } from 'framer-motion';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TARGET_COUNT = 10;

export function TrendingSidebar() {
  const [trending, setTrending] = useState<TrendingDuel[]>([]);
  const [recentlyEnded, setRecentlyEnded] = useState<RecentlyEndedDuel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchTrendingDuels().catch(() => []),
      fetchRecentlyEndedDuels().catch(() => []),
    ]).then(([t, r]) => {
      setTrending(t);
      setRecentlyEnded(r);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <aside className="w-64 shrink-0 hidden xl:block">
        <div className="sticky top-6">
          <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
            Results
          </h3>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (trending.length === 0 && recentlyEnded.length === 0) return null;

  // Show Results first; if fewer than TARGET_COUNT, backfill with Trending
  const trendingToShow = recentlyEnded.length < TARGET_COUNT
    ? trending.slice(0, TARGET_COUNT - recentlyEnded.length)
    : [];

  return (
    <aside className="w-64 shrink-0 hidden xl:block">
      <div className="sticky top-6 space-y-6">
        {/* Results section */}
        {recentlyEnded.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
              Results
            </h3>
            <div className="space-y-1">
              {recentlyEnded.map((duel, i) => {
                const agreePct = duel.totalVotes > 0
                  ? Math.round((duel.agreeCount / duel.totalVotes) * 100)
                  : 50;

                return (
                  <motion.div
                    key={duel.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.04 }}
                  >
                    <Link
                      to={`/d/${duel.slug}`}
                      className="block px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:text-accent transition-colors">
                          {duel.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                          {duel.categorySlug && (
                            <span className="text-accent">{duel.categoryName}</span>
                          )}
                          <span>{duel.totalVotes} votes</span>
                          <span>{timeAgo(duel.endsAt)}</span>
                        </div>
                        {/* Winner result */}
                        {duel.winner && (
                          <div className="mt-1.5">
                            {duel.duelType === 'binary' ? (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-vote-agree"
                                    style={{ width: `${agreePct}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-semibold ${
                                  duel.winner === 'Tie' ? 'text-foreground-muted'
                                    : duel.agreeCount > duel.disagreeCount ? 'text-vote-agree' : 'text-vote-disagree'
                                }`}>
                                  {duel.winner === 'Tie' ? 'Tie' : `${duel.winner} ${duel.winnerPct}%`}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-accent">
                                {duel.winner}{duel.winnerPct != null ? ` ${duel.winnerPct}%` : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Trending section — shown only if Results doesn't fill TARGET_COUNT */}
        {trendingToShow.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
              Trending
            </h3>
            <div className="space-y-1">
              {trendingToShow.map((duel, i) => {
                const agreePct = duel.totalVotes > 0
                  ? Math.round((duel.agreeCount / duel.totalVotes) * 100)
                  : 50;

                return (
                  <motion.div
                    key={duel.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: (recentlyEnded.length + i) * 0.04 }}
                  >
                    <Link
                      to={`/d/${duel.slug}`}
                      className="block px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-foreground-muted font-mono mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:text-accent transition-colors">
                            {duel.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                            {duel.categorySlug && (
                              <span className="text-accent">{duel.categoryName}</span>
                            )}
                            <span>{duel.totalVotes} votes</span>
                            {duel.duelType === 'binary' && (
                              <span className="w-8 h-1 bg-surface-hover rounded-full overflow-hidden">
                                <span
                                  className="block h-full bg-vote-agree rounded-full"
                                  style={{ width: `${agreePct}%` }}
                                />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
