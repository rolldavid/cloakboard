import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchDuels, fetchFeaturedDuels, fetchRecentlyEndedDuels, type Duel, type FeaturedDuels, type RecentlyEndedDuel } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { FeaturedDuel } from '@/components/feed/FeaturedDuel';
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

export function CategoryPage() {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const navigate = useNavigate();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featuredMap, setFeaturedMap] = useState<FeaturedDuels | null>(null);
  const [recentlyEnded, setRecentlyEnded] = useState<RecentlyEndedDuel[]>([]);

  useEffect(() => { setPage(1); }, [categorySlug]);

  const loadData = useCallback(async () => {
    if (!categorySlug) return;
    setLoading(true);
    const [featured, data, ended] = await Promise.all([
      fetchFeaturedDuels({ category: categorySlug }).catch(() => null as FeaturedDuels | null),
      fetchDuels({ category: categorySlug, sort: 'trending', page }),
      fetchRecentlyEndedDuels({ category: categorySlug, limit: 8 }).catch(() => ({ duels: [] as RecentlyEndedDuel[], total: 0 })),
    ]);
    setFeaturedMap(featured);
    setDuels(data.duels);
    setTotal(data.total);
    setRecentlyEnded(ended.duels);
    setLoading(false);
  }, [categorySlug, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalPages = Math.ceil(total / 24);
  const featuredDuel = featuredMap?.trending ?? null;
  const gridDuels = featuredDuel ? duels.filter((d) => d.id !== featuredDuel.id) : duels;

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  return (
    <div>
      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <>
              {/* Featured skeleton */}
              <div className="bg-surface border border-border rounded-lg p-5 mb-4 animate-pulse">
                <div className="h-4 w-24 bg-surface-hover rounded mb-3" />
                <div className="h-5 w-3/4 bg-surface-hover rounded mb-2" />
                <div className="h-4 w-1/2 bg-surface-hover rounded mb-4" />
                <div className="flex gap-2">
                  <div className="h-8 flex-1 bg-surface-hover rounded" />
                  <div className="h-8 flex-1 bg-surface-hover rounded" />
                </div>
              </div>
              {/* Grid skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Featured duel */}
              {featuredDuel && <FeaturedDuel duel={featuredDuel} />}

              {/* Duel grid */}
              {gridDuels.length === 0 && !featuredDuel ? (
                <div className="text-center py-16 text-foreground-muted">
                  <p className="text-lg font-medium">No duels in this category yet</p>
                  <p className="text-sm mt-1">Be the first to create one</p>
                  <Link
                    to="/create"
                    className="inline-block mt-4 px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
                  >
                    Create a Duel
                  </Link>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {gridDuels.map((duel, i) => (
                      <motion.div
                        key={duel.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.03 }}
                      >
                        <DuelCard duel={duel} onVote={handleVote} />
                      </motion.div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-hover disabled:opacity-30"
                      >
                        Prev
                      </button>
                      <span className="text-sm text-foreground-muted">
                        {page} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-hover disabled:opacity-30"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Right sidebar — recently completed duels */}
        <aside className="w-64 shrink-0 hidden xl:block">
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
                Results
              </h3>
              {recentlyEnded.length > 0 && (
                <Link
                  to={`/results?category=${categorySlug}`}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  View all &rarr;
                </Link>
              )}
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-14 bg-surface-hover rounded animate-pulse" />
                ))}
              </div>
            ) : recentlyEnded.length === 0 ? (
              <p className="text-xs text-foreground-muted">No results yet</p>
            ) : (
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
                        <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:text-accent transition-colors">
                          {duel.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                          <span>{duel.totalVotes} votes</span>
                          <span>{timeAgo(duel.endsAt)}</span>
                        </div>
                        {duel.winner && duel.duelType === 'binary' && (
                          <div className="flex items-center gap-1.5 mt-1">
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
                              {duel.winner === 'Tie' ? 'Tie' : `${duel.winnerPct}%`}
                            </span>
                          </div>
                        )}
                        {duel.winner && duel.duelType !== 'binary' && (
                          <span className="text-xs font-semibold text-accent mt-1 block">
                            {duel.winner}{duel.winnerPct != null ? ` ${duel.winnerPct}%` : ''}
                          </span>
                        )}
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
