import { Link } from 'react-router-dom';
import type { Category, DuelSort } from '@/lib/api/duelClient';

const SORTS: { key: DuelSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'controversial', label: 'Controversial' },
];

interface FeedNavProps {
  categories: Category[];
  activeSort: DuelSort | null;
  activeCategory: string | null;
  onSortClick: (sort: DuelSort) => void;
}

export function FeedNav({ categories, activeSort, activeCategory, onSortClick }: FeedNavProps) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 mb-4">
      {SORTS.map((s) => (
        <button
          key={s.key}
          onClick={() => onSortClick(s.key)}
          className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeSort === s.key
              ? 'bg-accent text-white'
              : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          {s.label}
        </button>
      ))}
      <div className="w-px h-5 bg-border mx-1.5 shrink-0" />
      {categories.map((cat) => (
        <Link
          key={cat.slug}
          to={`/c/${cat.slug}`}
          className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            activeCategory === cat.slug
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
