import { useEffect, useState, useRef } from 'react';
import { fetchDuels, fetchFeaturedDuels, type Duel, type DuelSort, type FeaturedDuels } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { TrendingSidebar } from '@/components/feed/TrendingSidebar';
import { FeaturedDuel } from '@/components/feed/FeaturedDuel';
import { CreateDuelCTA } from '@/components/feed/CreateDuelCTA';
import { useAppStore } from '@/store/index';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';

const VALID_SORTS: DuelSort[] = ['trending', 'new', 'controversial'];

export function HomePage() {
  const [searchParams] = useSearchParams();
  const sortParam = searchParams.get('sort') as DuelSort | null;
  const sort: DuelSort = sortParam && VALID_SORTS.includes(sortParam) ? sortParam : 'trending';
  const { isAuthenticated } = useAppStore();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featuredMap, setFeaturedMap] = useState<FeaturedDuels | null>(null);
  const navigate = useNavigate();

  // Reset page when sort changes
  const prevSortRef = useRef(sort);
  useEffect(() => {
    if (prevSortRef.current !== sort) {
      prevSortRef.current = sort;
      setPage(1);
    }
  }, [sort]);

  // Parallel fetch: featured + duels
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchFeaturedDuels().catch(() => null as FeaturedDuels | null),
      fetchDuels({ sort, page }),
    ]).then(([featured, data]) => {
      setFeaturedMap(featured);
      setDuels(data.duels);
      setTotal(data.total);
    }).catch(() => { /* all failed */ })
      .finally(() => setLoading(false));
  }, [sort, page]);

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  const totalPages = Math.ceil(total / 24);
  const featuredDuel = featuredMap?.[sort] ?? null;

  // Exclude featured duel from grid to avoid duplication
  const gridDuels = featuredDuel
    ? duels.filter((d) => d.id !== featuredDuel.id)
    : duels;

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
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
                ))}
              </div>
            </>
          ) : (
          <>
          {/* Featured duel */}
          {featuredDuel && <FeaturedDuel duel={featuredDuel} />}

          {/* Duel grid */}
          {gridDuels.length === 0 ? (
            <div className="text-center py-16 text-foreground-muted">
              <p className="text-lg font-medium">No duels found</p>
              <p className="text-sm mt-1">Be the first to create one</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {gridDuels.map((duel, i) => {
                  const items = [];
                  // Inject CTA card every 6th position for authenticated users
                  if (isAuthenticated && i > 0 && i % 6 === 0) {
                    items.push(
                      <motion.div
                        key={`cta-${i}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.03 }}
                      >
                        <CreateDuelCTA />
                      </motion.div>
                    );
                  }
                  items.push(
                    <motion.div
                      key={duel.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.03 }}
                    >
                      <DuelCard duel={duel} onVote={handleVote} />
                    </motion.div>
                  );
                  return items;
                })}
              </div>

              {/* Pagination */}
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

        {/* Trending sidebar */}
        <TrendingSidebar />
      </div>
    </div>
  );
}
