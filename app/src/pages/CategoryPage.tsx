import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchDuels, fetchCategories, type Duel, type Category, type DuelSort } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { CategoryBar } from '@/components/nav/CategoryBar';
import { SubcategorySidebar } from '@/components/nav/SubcategorySidebar';

const SORTS: { key: DuelSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'controversial', label: 'Controversial' },
  { key: 'ending', label: 'Ending Soon' },
];

export function CategoryPage() {
  const { categorySlug, subSlug } = useParams<{ categorySlug: string; subSlug?: string }>();
  const navigate = useNavigate();
  const [duels, setDuels] = useState<Duel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sort, setSort] = useState<DuelSort>('trending');
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
        subcategory: subSlug,
        sort,
        page,
      });
      setDuels(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [categorySlug, subSlug, sort, page]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadDuels(); }, [loadDuels]);

  const category = categories.find((c) => c.slug === categorySlug);
  const totalPages = Math.ceil(total / 24);

  const handleVote = (duelId: number, _direction: boolean) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  return (
    <div>
      {/* Category bar */}
      <div className="mb-4">
        <CategoryBar categories={categories} />
      </div>

      {/* Sort tabs */}
      <div className="flex items-center gap-1 mb-4">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => { setSort(s.key); setPage(1); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              sort === s.key
                ? 'bg-surface-hover text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-6">
        {/* Subcategory sidebar */}
        {category && (
          <SubcategorySidebar category={category} />
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
                {duels.map((duel) => (
                  <DuelCard key={duel.id} duel={duel} onVote={handleVote} />
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
