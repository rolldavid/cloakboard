import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrendingDuels, type TrendingDuel } from '@/lib/api/duelClient';
import { motion } from 'framer-motion';

export function TrendingSidebar() {
  const [trending, setTrending] = useState<TrendingDuel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTrendingDuels()
      .then(setTrending)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <aside className="w-64 shrink-0 hidden xl:block">
        <div className="sticky top-6">
          <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
            Trending
          </h3>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-surface-hover rounded animate-pulse" />
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (trending.length === 0) return null;

  return (
    <aside className="w-64 shrink-0 hidden xl:block">
      <div className="sticky top-6">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Trending
        </h3>
        <div className="space-y-1">
          {trending.map((duel, i) => {
            const agreePct = duel.totalVotes > 0
              ? Math.round((duel.agreeCount / duel.totalVotes) * 100)
              : 50;

            return (
              <motion.div
                key={duel.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
              >
                <Link
                  to={`/d/${duel.slug}`}
                  className="block px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-foreground-muted font-mono mt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-medium line-clamp-2 group-hover:text-accent transition-colors">
                        {duel.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                        {duel.categorySlug && (
                          <span className="text-accent">{duel.categoryName}</span>
                        )}
                        <span>{duel.totalVotes} votes</span>
                        {duel.duelType === 'binary' && (
                          <span className="w-8 h-1 bg-surface-hover rounded-full overflow-hidden">
                            <span
                              className="block h-full bg-vote-agree rounded-full"
                              style={{ width: `${agreePct}%` }}
                            />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
