import { useEffect, useState, useCallback } from 'react';
import { fetchDuels, fetchFeaturedDuels, fetchCategories, type Duel, type Category, type DuelSort, type FeaturedDuels } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { TrendingSidebar } from '@/components/feed/TrendingSidebar';
import { FeaturedDuel } from '@/components/feed/FeaturedDuel';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

const TOP_SORTS: { key: DuelSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'controversial', label: 'Controversial' },
];

export function HomePage() {
  const [duels, setDuels] = useState<Duel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sort, setSort] = useState<DuelSort>('trending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featuredMap, setFeaturedMap] = useState<FeaturedDuels | null>(null);
  const navigate = useNavigate();

  const loadCategories = useCallback(async () => {
    try {
      const cats = await fetchCategories();
      setCategories(cats);
    } catch { /* non-fatal */ }
  }, []);

  const loadFeatured = useCallback(async () => {
    try {
      const duels = await fetchFeaturedDuels();
      setFeaturedMap(duels);
    } catch { setFeaturedMap(null); }
  }, []);

  const loadDuels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDuels({ sort, page });
      setDuels(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [sort, page]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadFeatured(); }, [loadFeatured]);
  useEffect(() => { loadDuels(); }, [loadDuels]);

  const handleTopSortClick = (newSort: DuelSort) => {
    setSort(newSort);
    setPage(1);
  };

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
      {/* Unified top bar: sorts | categories */}
      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 mb-4">
        {TOP_SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => handleTopSortClick(s.key)}
            className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              sort === s.key
                ? 'bg-accent text-white'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {s.label}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-1.5 shrink-0" />
        {categories.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => navigate(`/c/${cat.slug}`)}
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap text-foreground-muted hover:text-foreground hover:bg-surface-hover"
          >
            {cat.name}
          </button>
        ))}
      </nav>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Featured duel */}
          {featuredDuel && <FeaturedDuel duel={featuredDuel} />}

          {/* Duel grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          ) : gridDuels.length === 0 ? (
            <div className="text-center py-16 text-foreground-muted">
              <p className="text-lg font-medium">No duels found</p>
              <p className="text-sm mt-1">Be the first to create one</p>
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
        </div>

        {/* Trending sidebar */}
        <TrendingSidebar />
      </div>
    </div>
  );
}
