import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchRecentlyEndedDuels, type RecentlyEndedDuel } from '@/lib/api/duelClient';
import { ResultCard } from '@/components/duel/ResultCard';
import { motion } from 'framer-motion';

export function ResultsPage() {
  const [searchParams] = useSearchParams();
  const category = searchParams.get('category') || undefined;
  const [results, setResults] = useState<RecentlyEndedDuel[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRecentlyEndedDuels({ category, page, limit: 24 });
      setResults(data.duels);
      setTotal(data.total);
    } catch { /* non-fatal */ }
    setLoading(false);
  }, [category, page]);

  useEffect(() => { loadResults(); }, [loadResults]);

  const totalPages = Math.ceil(total / 24);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">
        {category ? `Results — ${category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ')}` : 'All Results'}
      </h2>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 text-foreground-muted">
          <p className="text-lg font-medium">No results yet</p>
          <p className="text-sm mt-1">Ended duels with votes will appear here</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {results.map((duel, i) => (
              <motion.div
                key={duel.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.03 }}
              >
                <ResultCard duel={duel} />
              </motion.div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-hover disabled:opacity-30"
              >
                Prev
              </button>
              <span className="text-sm text-foreground-muted">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-surface-hover disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
