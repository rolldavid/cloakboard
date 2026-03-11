import { useEffect, useState, useCallback } from 'react';
import { fetchDuels, fetchFeaturedDuels, type Duel } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';
import { FeaturedDuel } from '@/components/feed/FeaturedDuel';
import { TrendingSidebar } from '@/components/feed/TrendingSidebar';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export function BreakingPage() {
  const [allDuels, setAllDuels] = useState<Duel[]>([]);
  const [featuredDuel, setFeaturedDuel] = useState<Duel | null>(null);
  const [filterSubcategory, setFilterSubcategory] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const navigate = useNavigate();

  const loadDuels = useCallback(async () => {
    setInitialLoading(true);
    try {
      const [data, featured] = await Promise.all([
        fetchDuels({ sort: 'trending', breaking: true, limit: 100 }),
        fetchFeaturedDuels(),
      ]);
      setAllDuels(data.duels);
      setFeaturedDuel(featured.breaking ?? null);
    } catch { /* non-fatal */ }
    setInitialLoading(false);
  }, []);

  useEffect(() => { loadDuels(); }, [loadDuels]);

  const handleVote = (duelId: number) => {
    const duel = allDuels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  const handleSubcategoryClick = (slug: string | null) => {
    setFilterSubcategory(slug);
  };

  // Subcategory chips — only show if there are grid duels (non-featured) in that subcategory
  const subcategoryChips = (() => {
    const nonFeatured = allDuels.filter((d) => d.id !== featuredDuel?.id);
    const seen = new Set<string>();
    const chips: { slug: string; name: string }[] = [];
    for (const d of nonFeatured) {
      if (d.subcategorySlug && !seen.has(d.subcategorySlug)) {
        seen.add(d.subcategorySlug);
        chips.push({ slug: d.subcategorySlug, name: d.subcategoryName || d.subcategorySlug });
      }
    }
    return chips;
  })();

  // Client-side filter — exclude featured duel from grid
  const gridDuels = allDuels
    .filter((d) => d.id !== featuredDuel?.id)
    .filter((d) => !filterSubcategory || d.subcategorySlug === filterSubcategory);

  return (
    <div>
      <div className="flex gap-6">
        <div className="flex-1 min-w-0">
          {initialLoading ? (
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
                ))}
              </div>
            </>
          ) : allDuels.length === 0 ? (
            <div className="text-center py-20 text-foreground-muted">
              <p className="text-lg font-medium">No breaking news yet</p>
              <p className="text-sm mt-1">Check back soon for the latest stories.</p>
            </div>
          ) : (
            <>
              {featuredDuel && <FeaturedDuel duel={featuredDuel} />}

              {/* Subcategory chips */}
              {subcategoryChips.length > 1 && (
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
                  {subcategoryChips.map((sub) => (
                    <button
                      key={sub.slug}
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

              {gridDuels.length === 0 ? (
                <div className="text-center py-16 text-foreground-muted">
                  <p className="text-sm">No other breaking duels in this category</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {gridDuels.map((duel, i) => (
                    <motion.div
                      key={duel.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.03 }}
                    >
                      <DuelCard duel={duel} onVote={handleVote} />
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="hidden lg:block w-72 shrink-0">
          <TrendingSidebar />
        </div>
      </div>
    </div>
  );
}
