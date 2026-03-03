import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchDuels, type Duel } from '@/lib/api/duelClient';
import { motion, AnimatePresence } from 'framer-motion';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Duel[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleChange = (value: string) => {
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
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Search duels..."
            className="w-48 sm:w-64 pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {loading && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </form>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-1 w-full bg-surface border border-border rounded-md shadow-lg z-50 overflow-hidden"
          >
            {results.map((duel) => (
              <button
                key={duel.id}
                onClick={() => {
                  navigate(`/d/${duel.slug}`);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors border-b border-border last:border-b-0"
              >
                <div className="font-medium text-foreground truncate">{duel.title}</div>
                <div className="text-xs text-foreground-muted">
                  {duel.categoryName} · {duel.totalVotes} votes
                </div>
              </button>
            ))}
            <button
              onClick={() => {
                navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-sm text-accent hover:bg-surface-hover text-center"
            >
              See all results
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
