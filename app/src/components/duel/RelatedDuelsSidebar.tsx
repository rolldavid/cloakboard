import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchCategories, fetchDuels, type Duel, type Subcategory } from '@/lib/api/duelClient';

interface RelatedDuelsSidebarProps {
  currentDuelId: number;
  categorySlug: string | null;
  categoryName: string | null;
  inline?: boolean;
}

export function RelatedDuelsSidebar({ currentDuelId, categorySlug, categoryName, inline }: RelatedDuelsSidebarProps) {
  const [allSubcategories, setAllSubcategories] = useState<Subcategory[]>([]);
  const [activeSlugs, setActiveSlugs] = useState<Set<string>>(new Set());
  const [activeSubSlug, setActiveSubSlug] = useState<string | null>(null);
  const [duels, setDuels] = useState<Duel[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  // Load subcategories for the category
  useEffect(() => {
    if (!categorySlug) return;
    fetchCategories()
      .then((cats) => {
        const cat = cats.find((c) => c.slug === categorySlug);
        setAllSubcategories(cat?.subcategories || []);
      })
      .catch(() => {});
  }, [categorySlug]);

  // On mount, discover which subcategories have duels
  useEffect(() => {
    if (!categorySlug) return;
    fetchDuels({ category: categorySlug, sort: 'trending', limit: 50 })
      .then((res) => {
        const slugs = new Set<string>();
        for (const d of res.duels) {
          if (d.subcategorySlug) slugs.add(d.subcategorySlug);
        }
        setActiveSlugs(slugs);
      })
      .catch(() => {});
  }, [categorySlug]);

  // Subcategories filtered to only those with duels
  const subcategories = allSubcategories.filter((s) => activeSlugs.has(s.slug));

  // Load duels (re-fetch when subcategory changes)
  useEffect(() => {
    if (!categorySlug) return;
    setLoading(true);
    setIsFallback(false);

    fetchDuels({
      category: categorySlug,
      subcategory: activeSubSlug || undefined,
      sort: 'trending',
      limit: 8,
    })
      .then((res) => {
        const filtered = res.duels.filter((d) => d.id !== currentDuelId);
        if (filtered.length > 0) {
          setDuels(filtered);
          setLoading(false);
        } else {
          // Fallback: fetch trending across all categories
          return fetchDuels({ sort: 'trending', limit: 8 }).then((fallback) => {
            setDuels(fallback.duels.filter((d) => d.id !== currentDuelId));
            setIsFallback(true);
            setLoading(false);
          });
        }
      })
      .catch(() => setLoading(false));
  }, [categorySlug, activeSubSlug, currentDuelId]);

  const headerText = isFallback ? 'Active Duels' : `Related in ${categoryName || 'Category'}`;

  // ─── Skeleton ───
  const skeleton = (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 bg-surface-hover rounded animate-pulse" />
      ))}
    </div>
  );

  // ─── Filter pills ───
  const filterSlider = !isFallback && subcategories.length > 0 && (
    <div className="flex items-center gap-1.5 mb-3">
      <FilterPill label="All" active={!activeSubSlug} onClick={() => setActiveSubSlug(null)} />
      <div className="overflow-x-auto scrollbar-hide flex gap-1.5 mask-fade-r py-0.5 min-w-0">
        {subcategories.map((sub) => (
          <FilterPill
            key={sub.slug}
            label={sub.name}
            active={activeSubSlug === sub.slug}
            onClick={() => setActiveSubSlug(sub.slug)}
          />
        ))}
      </div>
    </div>
  );

  // ─── Inline (mobile) layout ───
  if (inline) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          {headerText}
        </h3>
        {filterSlider}
        {loading ? skeleton : duels.length === 0 ? null : (
          <div className="overflow-x-auto scrollbar-hide mask-fade-x -mx-1 px-1">
            <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
              {duels.map((duel) => (
                <MobileDuelCard key={duel.id} duel={duel} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Desktop sidebar ───
  return (
    <aside className="w-72 shrink-0 hidden lg:block">
      <div className="sticky top-6">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          {headerText}
        </h3>
        {filterSlider}
        {loading ? skeleton : duels.length === 0 ? (
          <p className="text-xs text-foreground-muted">No duels found.</p>
        ) : (
          <div className="space-y-1">
            {duels.map((duel) => (
              <RelatedDuelItem key={duel.id} duel={duel} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-2.5 py-1 text-xs rounded-full border transition-colors whitespace-nowrap ${
        active
          ? 'bg-accent/10 text-accent border-accent'
          : 'text-foreground-muted border-transparent hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function RelatedDuelItem({ duel }: { duel: Duel }) {
  const agreePct = duel.totalVotes > 0
    ? Math.round((duel.agreeCount / duel.totalVotes) * 100)
    : 50;

  return (
    <Link
      to={`/d/${duel.slug}`}
      className="block px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
    >
      <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:text-accent transition-colors">
        {duel.title}
      </p>
      <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
        {duel.subcategoryName && (
          <span className="text-accent">{duel.subcategoryName}</span>
        )}
        <span>{duel.totalVotes} votes</span>
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-surface-hover uppercase">
          {duel.duelType}
        </span>
        {duel.duelType === 'binary' && (
          <span className="w-8 h-1 bg-surface-hover rounded-full overflow-hidden">
            <span
              className="block h-full bg-vote-agree rounded-full"
              style={{ width: `${agreePct}%` }}
            />
          </span>
        )}
      </div>
    </Link>
  );
}

function MobileDuelCard({ duel }: { duel: Duel }) {
  const agreePct = duel.totalVotes > 0
    ? Math.round((duel.agreeCount / duel.totalVotes) * 100)
    : 50;

  return (
    <Link
      to={`/d/${duel.slug}`}
      className="block w-48 shrink-0 px-3 py-2.5 rounded-lg border border-border hover:bg-surface-hover transition-colors"
    >
      <p className="text-sm text-foreground font-medium line-clamp-2">
        {duel.title}
      </p>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-foreground-muted">
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
    </Link>
  );
}
