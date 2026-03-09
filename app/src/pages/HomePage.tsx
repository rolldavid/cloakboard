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

const CATEGORY_SORTS: { key: DuelSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'controversial', label: 'Controversial' },
  { key: 'ending', label: 'Ending Soon' },
];

export function HomePage() {
  const [duels, setDuels] = useState<Duel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sort, setSort] = useState<DuelSort>('trending');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [featuredMap, setFeaturedMap] = useState<FeaturedDuels | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [filterSubcategory, setFilterSubcategory] = useState<string | null>(null);
  const navigate = useNavigate();

  const activeCat = categories.find((c) => c.slug === activeCategory);

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
        category: activeCategory || undefined,
        subcategory: filterSubcategory || undefined,
      });
      setDuels(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [sort, page, activeCategory, filterSubcategory]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadFeatured(); }, [loadFeatured]);
  useEffect(() => { loadDuels(); }, [loadDuels]);

  const handleTopSortClick = (newSort: DuelSort) => {
    setActiveCategory(null);
    setFilterSubcategory(null);
    setSort(newSort);
    setPage(1);
  };

  const handleCategoryClick = (slug: string) => {
    if (activeCategory === slug) {
      // Deselect — go back to trending
      setActiveCategory(null);
      setFilterSubcategory(null);
      setSort('trending');
    } else {
      setActiveCategory(slug);
      setFilterSubcategory(null);
      setSort('trending');
    }
    setPage(1);
  };

  const handleCategorySortChange = (newSort: DuelSort) => {
    setSort(newSort);
    setFilterSubcategory(null);
    setPage(1);
  };

  const handleSubcategoryChange = (slug: string | null) => {
    setFilterSubcategory(slug);
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
              !activeCategory && sort === s.key
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
            onClick={() => handleCategoryClick(cat.slug)}
            className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              activeCategory === cat.slug
                ? 'bg-accent text-white'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </nav>

      {/* Sort tabs — only when a category is selected */}
      {activeCategory && (
        <div className="flex items-center gap-1 mb-4">
          {CATEGORY_SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => handleCategorySortChange(s.key)}
              className="relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors text-foreground-muted hover:text-foreground"
            >
              {sort === s.key && (
                <motion.div
                  layoutId="sortIndicator"
                  className="absolute inset-0 bg-surface-hover rounded-md"
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className={`relative z-10 ${sort === s.key ? 'text-foreground' : ''}`}>{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Featured duel */}
          {featuredDuel && <FeaturedDuel duel={featuredDuel} />}

          {/* Subcategory chips — only when a category with subcategories is selected */}
          {activeCat && activeCat.subcategories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 mb-4">
              <button
                onClick={() => handleSubcategoryChange(null)}
                className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  !filterSubcategory
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
                }`}
              >
                All {activeCat.name}
              </button>
              {activeCat.subcategories.map((sub) => (
                <button
                  key={sub.slug}
                  onClick={() => handleSubcategoryChange(filterSubcategory === sub.slug ? null : sub.slug)}
                  className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    filterSubcategory === sub.slug
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
                  }`}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}

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
              <p className="text-sm mt-1">
                {activeCategory ? 'Try a different category or sort' : 'Be the first to create one'}
              </p>
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
