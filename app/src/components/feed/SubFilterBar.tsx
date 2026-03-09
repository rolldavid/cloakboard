import type { Category } from '@/lib/api/duelClient';

interface SubFilterBarProps {
  categories: Category[];
  activeCategory: string | null;
  activeSubcategory: string | null;
  onCategoryChange: (slug: string | null) => void;
  onSubcategoryChange: (slug: string | null) => void;
}

export function SubFilterBar({
  categories,
  activeCategory,
  activeSubcategory,
  onCategoryChange,
  onSubcategoryChange,
}: SubFilterBarProps) {
  const activeCat = categories.find((c) => c.slug === activeCategory);

  return (
    <div className="mb-4 space-y-2">
      {/* Category chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
        <button
          onClick={() => { onCategoryChange(null); onSubcategoryChange(null); }}
          className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            !activeCategory
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => {
              if (activeCategory === cat.slug) {
                onCategoryChange(null);
                onSubcategoryChange(null);
              } else {
                onCategoryChange(cat.slug);
                onSubcategoryChange(null);
              }
            }}
            className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeCategory === cat.slug
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover border border-transparent'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Subcategory chips — shown when a category is selected */}
      {activeCat && activeCat.subcategories.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 pl-3">
          <button
            onClick={() => onSubcategoryChange(null)}
            className={`shrink-0 px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
              !activeSubcategory
                ? 'bg-accent/10 text-accent'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            All {activeCat.name}
          </button>
          {activeCat.subcategories.map((sub) => (
            <button
              key={sub.slug}
              onClick={() => {
                onSubcategoryChange(activeSubcategory === sub.slug ? null : sub.slug);
              }}
              className={`shrink-0 px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                activeSubcategory === sub.slug
                  ? 'bg-accent/10 text-accent'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
