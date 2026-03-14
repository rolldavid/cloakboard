import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { searchDuels, type Duel } from '@/lib/api/duelClient';
import { motion, AnimatePresence } from 'framer-motion';

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

function SearchDropdown({ results, query, onSelect, onSeeAll }: {
  results: Duel[];
  query: string;
  onSelect: (slug: string) => void;
  onSeeAll: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full mt-1 w-full bg-background border border-border rounded-md shadow-lg z-50 overflow-hidden"
    >
      {results.map((duel) => (
        <button
          key={duel.id}
          onClick={() => onSelect(duel.slug)}
          className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors border-b border-border last:border-b-0"
        >
          <div className="font-medium text-foreground truncate">{duel.title}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-foreground-muted">
            {duel.status === 'active' ? (
              <span className="text-green-500">Active</span>
            ) : (
              <span className="text-foreground-muted">Ended</span>
            )}
            {duel.categoryName && <><span>·</span><span>{duel.categoryName}</span></>}
            <span>·</span>
            <span>{duel.totalVotes} votes</span>
          </div>
        </button>
      ))}
      <button
        onClick={onSeeAll}
        className="w-full px-3 py-2 text-sm text-accent hover:bg-surface-hover text-center"
      >
        See all results
      </button>
    </motion.div>
  );
}

function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Duel[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchDuels(value.trim());
        setResults(data.duels.slice(0, 6));
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  return { query, setQuery, results, open, setOpen, loading, handleChange };
}

/** Desktop search bar — hidden on mobile */
export function SearchBar() {
  const { query, setQuery, results, open, setOpen, loading, handleChange } = useSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = useCallback(() => {
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }, [setQuery, setOpen]);

  // Clear on any route change
  const pathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== pathRef.current) {
      clear();
    }
    pathRef.current = location.pathname;
  }, [location.pathname, clear]);

  // Click outside — clear input and close
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        clear();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [clear]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      clear();
    }
  };

  return (
    <div ref={ref} className="relative hidden md:block">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
            <SearchIcon />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search duels..."
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {loading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </form>

      <AnimatePresence>
        {open && results.length > 0 && (
          <SearchDropdown
            results={results}
            query={query}
            onSelect={(slug) => { navigate(`/d/${slug}`); clear(); }}
            onSeeAll={() => { navigate(`/search?q=${encodeURIComponent(query.trim())}`); clear(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mobile search icon — visible only on small screens */
export function MobileSearchIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden p-1.5 text-foreground-muted hover:text-foreground transition-colors"
    >
      <SearchIcon />
    </button>
  );
}

/** Mobile full-width search bar — renders below the header */
export function MobileSearchBar({ onClose }: { onClose: () => void }) {
  const { query, setQuery, results, open, setOpen, loading, handleChange } = useSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Close on navigation (skip initial mount)
  const initialPath = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== initialPath.current) {
      onClose();
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (!query) onClose();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [query, onClose, setOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      onClose();
    }
  };

  return (
    <div ref={ref} className="md:hidden border-b border-border px-4 py-2 bg-background relative">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
            <SearchIcon />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search duels..."
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {loading ? (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </form>

      <AnimatePresence>
        {open && results.length > 0 && (
          <SearchDropdown
            results={results}
            query={query}
            onSelect={(slug) => { navigate(`/d/${slug}`); onClose(); }}
            onSeeAll={() => { navigate(`/search?q=${encodeURIComponent(query.trim())}`); onClose(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
