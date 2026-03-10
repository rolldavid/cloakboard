import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchDuels, fetchCategories, fetchRecentlyEndedDuels, type Duel, type Category, type DuelSort, type RecentlyEndedDuel } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { ResultCard } from '@/components/duel/ResultCard';
import { FeedNav } from '@/components/nav/FeedNav';
import { SubcategorySidebar } from '@/components/nav/SubcategorySidebar';
import { motion } from 'framer-motion';

export function CategoryPage() {
  const { categorySlug, subSlug: routeSubSlug } = useParams<{ categorySlug: string; subSlug?: string }>();
  const navigate = useNavigate();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subSlug, setSubSlug] = useState<string | null>(routeSubSlug || null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<RecentlyEndedDuel[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);

  const loadCategories = useCallback(async () => {
    try {
      const cats = await fetchCategories();
      setCategories(cats);
    } catch { /* non-fatal */ }
  }, []);

  const loadDuels = useCallback(async () => {
    if (showResults) return;
    setLoading(true);
    try {
      const data = await fetchDuels({
        category: categorySlug,
        subcategory: subSlug || undefined,
        sort: 'trending',
        page,
      });
      setDuels(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [categorySlug, subSlug, page, showResults]);

  const loadResults = useCallback(async () => {
    if (!showResults || !categorySlug) return;
    setLoading(true);
    try {
      const data = await fetchRecentlyEndedDuels({ category: categorySlug, page, limit: 24 });
      setResults(data.duels);
      setResultsTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [categorySlug, page, showResults]);

  // Reset filters when switching categories
  useEffect(() => { setSubSlug(null); setPage(1); setShowResults(false); }, [categorySlug]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadDuels(); }, [loadDuels]);
  useEffect(() => { loadResults(); }, [loadResults]);

  const category = categories.find((c) => c.slug === categorySlug);
  const totalPages = Math.ceil((showResults ? resultsTotal : total) / 24);

  const handleSortClick = (sort: DuelSort) => {
    navigate(`/?sort=${sort}`);
  };

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  const handleSubSelect = (slug: string | null) => {
    setSubSlug(slug);
    setPage(1);
    setShowResults(false);
    const path = slug ? `/c/${categorySlug}/${slug}` : `/c/${categorySlug}`;
    window.history.replaceState(null, '', path);
  };

  const handleShowResults = () => {
    setShowResults(true);
    setSubSlug(null);
    setPage(1);
    window.history.replaceState(null, '', `/c/${categorySlug}`);
  };

  return (
    <div>
      <FeedNav
        categories={categories}
        activeSort={null}
        activeCategory={categorySlug || null}
        onSortClick={handleSortClick}
      />

      <div className="flex gap-6">
        {/* Subcategory sidebar */}
        {category && (
          <SubcategorySidebar
            category={category}
            activeSubSlug={subSlug}
            showResults={showResults}
            onSelect={handleSubSelect}
            onShowResults={handleShowResults}
          />
        )}

        {/* Main grid */}
        <div className="flex-1 min-w-0">
          {showResults && (
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Results — {category?.name}
            </h2>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
              ))}
            </div>
          ) : showResults ? (
            results.length === 0 ? (
              <div className="text-center py-16 text-foreground-muted">
                <p className="text-lg font-medium">No results yet in {category?.name || 'this category'}</p>
                <p className="text-sm mt-1">Ended duels with votes will appear here</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {results.map((duel, i) => (
                    <motion.div
                      key={duel.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.03 }}
                    >
                      <ResultCard duel={duel} />
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
            )
          ) : duels.length === 0 ? (
            <div className="text-center py-16 text-foreground-muted">
              <p className="text-lg font-medium">No duels in {category?.name || 'this category'}</p>
              <p className="text-sm mt-1">Be the first to create one</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {duels.map((duel, i) => (
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
        </div>
      </div>
    </div>
  );
}
