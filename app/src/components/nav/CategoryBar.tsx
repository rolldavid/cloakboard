import { Link, useParams } from 'react-router-dom';
import type { Category } from '@/lib/api/duelClient';

interface CategoryBarProps {
  categories: Category[];
}

export function CategoryBar({ categories }: CategoryBarProps) {
  const { categorySlug } = useParams<{ categorySlug?: string }>();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
      <Link
        to="/"
        className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
          !categorySlug
            ? 'bg-accent text-white'
            : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
        }`}
      >
        All
      </Link>
      {categories.map((cat) => (
        <Link
          key={cat.slug}
          to={`/c/${cat.slug}`}
          className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            categorySlug === cat.slug
              ? 'bg-accent text-white'
              : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          {cat.name}
        </Link>
      ))}
    </nav>
  );
}
