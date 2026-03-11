import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchDuels, fetchFeaturedDuels, fetchCategories, type Duel, type Category, type DuelSort, type FeaturedDuels, type Subcategory } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { TrendingSidebar } from '@/components/feed/TrendingSidebar';
import { FeaturedDuel } from '@/components/feed/FeaturedDuel';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';

interface SubcategoryWithCategory extends Subcategory {
  categorySlug: string;
}

const VALID_SORTS: DuelSort[] = ['trending', 'new', 'controversial'];

export function HomePage() {
  const [searchParams] = useSearchParams();
  const sortParam = searchParams.get('sort') as DuelSort | null;
  const sort: DuelSort = sortParam && VALID_SORTS.includes(sortParam) ? sortParam : 'trending';
  const [duels, setDuels] = useState<Duel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterSubcategory, setFilterSubcategory] = useState<string | null>(null);
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
      const data = await fetchDuels({
        sort,
        page,
        subcategory: filterSubcategory || undefined,
      });
      setDuels(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [sort, page, filterSubcategory]);

  // Reset subcategory filter and page when sort changes
  const prevSortRef = useRef(sort);
  useEffect(() => {
    if (prevSortRef.current !== sort) {
      prevSortRef.current = sort;
      setFilterSubcategory(null);
      setPage(1);
    }
  }, [sort]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadFeatured(); }, [loadFeatured]);
  useEffect(() => { loadDuels(); }, [loadDuels]);

  const handleSubcategoryClick = (slug: string | null) => {
    setFilterSubcategory(slug);
    setPage(1);
  };

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  // Flatten all subcategories across categories, sorted by activity DESC
  const allSubcategories: SubcategoryWithCategory[] = categories
    .flatMap((c) => c.subcategories.map((s) => ({ ...s, categorySlug: c.slug })))
    .sort((a, b) => b.activity - a.activity);

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

          {/* Subcategory chips */}
          {allSubcategories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 mb-4">
              <button
                onClick={() => handleSubcategoryClick(null)}
                className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                  !filterSubcategory
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'text-foreground-muted hover:text-foreground bg-surface border border-border hover:border-border-hover'
                }`}
              >
                All
              </button>
              {allSubcategories.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSubcategoryClick(filterSubcategory === sub.slug ? null : sub.slug)}
                  className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                    filterSubcategory === sub.slug
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'text-foreground-muted hover:text-foreground bg-surface border border-border hover:border-border-hover'
                  }`}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}

          {/* Duel grid */}
          {gridDuels.length === 0 ? (
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
          </>
          )}
        </div>

        {/* Trending sidebar */}
        <TrendingSidebar />
      </div>
    </div>
  );
}
