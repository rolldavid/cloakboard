import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { searchDuels, type Duel } from '@/lib/api/duelClient';
import { DuelCard } from '@/components/duel/DuelCard';

export function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [duels, setDuels] = useState<Duel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!query.trim()) {
      setDuels([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    searchDuels(query.trim(), page)
      .then((data) => {
        setDuels(data.duels);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [query, page]);

  const handleVote = (duelId: number) => {
    const duel = duels.find((d) => d.id === duelId);
    navigate(`/d/${duel?.slug || duelId}`);
  };

  const totalPages = Math.ceil(total / 24);

  return (
    <div>
      <h1 className="text-lg font-bold text-foreground mb-1">
        Search results for "{query}"
      </h1>
      <p className="text-sm text-foreground-muted mb-4">{total} results</p>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-surface border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : duels.length === 0 ? (
        <div className="text-center py-16 text-foreground-muted">
          <p className="text-lg font-medium">No results found</p>
          <p className="text-sm mt-1">Try different keywords</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {duels.map((duel) => (
              <DuelCard key={duel.id} duel={duel} onVote={handleVote} />
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
              <span className="text-sm text-foreground-muted">{page} / {totalPages}</span>
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
