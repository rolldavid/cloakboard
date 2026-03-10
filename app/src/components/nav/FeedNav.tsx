import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  activeBreaking?: boolean;
  onSortClick: (sort: DuelSort) => void;
}

export function FeedNav({ categories, activeSort, activeCategory, activeBreaking, onSortClick }: FeedNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const isBreakingActive = activeBreaking || location.pathname === '/breaking';

  const handleSortClick = (sort: DuelSort) => {
    if (isHome) {
      onSortClick(sort);
    } else {
      navigate(`/?sort=${sort}`);
    }
  };

  const sortButton = (s: { key: DuelSort; label: string }) => (
    <button
      key={s.key}
      onClick={() => handleSortClick(s.key)}
      className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
        activeSort === s.key && isHome
          ? 'bg-accent text-white'
          : 'text-foreground-muted hover:text-foreground hover:bg-surface-hover'
      }`}
    >
      {s.label}
    </button>
  );

  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1 mb-4">
      {sortButton(SORTS[0])}
      {sortButton(SORTS[1])}
      {sortButton(SORTS[2])}
      <Link
        to="/breaking"
        className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
          isBreakingActive
            ? 'bg-red-600 text-white'
            : 'text-red-500 hover:text-red-400 hover:bg-surface-hover'
        }`}
      >
        Breaking
      </Link>
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
