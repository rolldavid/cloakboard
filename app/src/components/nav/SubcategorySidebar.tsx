import type { Category } from '@/lib/api/duelClient';

interface SubcategorySidebarProps {
  category: Category;
  activeSubSlug: string | null;
  onSelect: (subSlug: string | null) => void;
}

export function SubcategorySidebar({ category, activeSubSlug, onSelect }: SubcategorySidebarProps) {
  return (
    <aside className="w-56 shrink-0 hidden lg:block">
      <div className="sticky top-6 space-y-1">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2 px-2">
          Subcategories
        </h3>
        <button
          onClick={() => onSelect(null)}
          className={`block w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors ${
            !activeSubSlug
              ? 'bg-surface-hover text-foreground font-medium'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          All {category.name}
        </button>
        {category.subcategories.map((sub) => (
          <button
            key={sub.slug}
            onClick={() => onSelect(activeSubSlug === sub.slug ? null : sub.slug)}
            className={`block w-full text-left px-2 py-1.5 text-sm rounded-md transition-colors ${
              activeSubSlug === sub.slug
                ? 'bg-surface-hover text-foreground font-medium'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {sub.name}
          </button>
        ))}
      </div>
    </aside>
  );
}
