import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchDuels, fetchCategories, type Duel, type Category, type DuelSort } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
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

  const loadCategories = useCallback(async () => {
    try {
      const cats = await fetchCategories();
      setCategories(cats);
    } catch { /* non-fatal */ }
  }, []);

  const loadDuels = useCallback(async () => {
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
  }, [categorySlug, subSlug, page]);

  // Reset subcategory filter when switching categories
  useEffect(() => { setSubSlug(null); setPage(1); }, [categorySlug]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadDuels(); }, [loadDuels]);

  const category = categories.find((c) => c.slug === categorySlug);
  const totalPages = Math.ceil(total / 24);

  const handleSortClick = (sort: DuelSort) => {
    navigate(`/?sort=${sort}`);
  };

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
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
            onSelect={(slug) => {
              setSubSlug(slug);
              setPage(1);
              // Update URL without full navigation
              const path = slug ? `/c/${categorySlug}/${slug}` : `/c/${categorySlug}`;
              window.history.replaceState(null, '', path);
            }}
          />
        )}

        {/* Main grid */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
              ))}
            </div>
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
