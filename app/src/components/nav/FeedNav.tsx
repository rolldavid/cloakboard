import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchCategories, type Category, type DuelSort } from '@/lib/api/duelClient';

const SORTS: { key: DuelSort; label: string }[] = [
  { key: 'trending', label: 'Trending' },
  { key: 'new', label: 'New' },
  { key: 'controversial', label: 'Controversial' },
];

const VALID_SORTS: DuelSort[] = ['trending', 'new', 'controversial'];

// Module-level cache so categories survive re-renders and route changes
let cachedCategories: Category[] | null = null;

export function FeedNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<Category[]>(cachedCategories || []);

  useEffect(() => {
    if (cachedCategories) return;
    fetchCategories()
      .then((cats) => {
        cachedCategories = cats;
        setCategories(cats);
      })
      .catch(() => {});
  }, []);

  // Derive active state from the current route
  const isHome = location.pathname === '/';
  const isBreaking = location.pathname === '/breaking';
  const categoryMatch = location.pathname.match(/^\/c\/([^/]+)/);
  const activeCategory = categoryMatch ? categoryMatch[1] : null;
  const sortParam = searchParams.get('sort') as DuelSort | null;
  const activeSort = isHome
    ? (sortParam && VALID_SORTS.includes(sortParam) ? sortParam : 'trending')
    : null;

  const handleSortClick = (sort: DuelSort) => {
    if (isHome) {
      setSearchParams(sort === 'trending' ? {} : { sort });
    } else {
      navigate(sort === 'trending' ? '/' : `/?sort=${sort}`);
    }
  };

  const sortButton = (s: { key: DuelSort; label: string }) => (
    <button
      key={s.key}
      onClick={() => handleSortClick(s.key)}
      className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
        activeSort === s.key
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
          isBreaking
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
