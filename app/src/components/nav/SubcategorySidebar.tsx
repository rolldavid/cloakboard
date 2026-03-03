import { Link, useParams } from 'react-router-dom';
import type { Category } from '@/lib/api/duelClient';

interface SubcategorySidebarProps {
  category: Category;
}

export function SubcategorySidebar({ category }: SubcategorySidebarProps) {
  const { subSlug } = useParams<{ subSlug?: string }>();

  return (
    <aside className="w-56 shrink-0 hidden lg:block">
      <div className="sticky top-6 space-y-1">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2 px-2">
          Subcategories
        </h3>
        <Link
          to={`/c/${category.slug}`}
          className={`block px-2 py-1.5 text-sm rounded-md transition-colors ${
            !subSlug
              ? 'bg-surface-hover text-foreground font-medium'
              : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          All {category.name}
        </Link>
        {category.subcategories.map((sub) => (
          <Link
            key={sub.slug}
            to={`/c/${category.slug}/${sub.slug}`}
            className={`block px-2 py-1.5 text-sm rounded-md transition-colors ${
              subSlug === sub.slug
                ? 'bg-surface-hover text-foreground font-medium'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            {sub.name}
          </Link>
        ))}
      </div>
    </aside>
  );
}
