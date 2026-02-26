import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fetchExploreCloaks } from '@/lib/api/feedClient';
import type { CloakExploreItem } from '@/lib/api/feedClient';

type SortMode = 'active' | 'members' | 'newest';

export function ExplorePage() {
  const [cloaks, setCloaks] = useState<CloakExploreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('active');

  useEffect(() => {
    fetchExploreCloaks()
      .then(setCloaks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = cloaks;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.slug?.toLowerCase().includes(q) ||
          c.address?.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      switch (sortMode) {
        case 'active':
          return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
        case 'members':
          return b.vote_count - a.vote_count;
        case 'newest':
          return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
        default:
          return 0;
      }
    });
  }, [cloaks, search, sortMode]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Explore Communities</h1>

      <div className="flex gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search communities..."
          className="flex-1 px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent"
        />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="px-3 py-2 bg-background-secondary border border-border rounded-md text-sm text-foreground focus:outline-none focus:border-accent"
        >
          <option value="active">Most Active</option>
          <option value="members">Most Votes</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-card border border-border rounded-md p-4 animate-pulse">
              <div className="h-5 bg-background-tertiary rounded w-2/3 mb-2" />
              <div className="h-3 bg-background-tertiary rounded w-1/2 mb-1" />
              <div className="h-3 bg-background-tertiary rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <p className="text-foreground-muted">
            {search ? 'No communities match your search' : 'No communities yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((cloak) => (
            <Link
              key={cloak.address}
              to={`/c/${cloak.slug || cloak.address}`}
              className="bg-card border border-border rounded-md p-4 hover:border-border-hover transition-colors"
            >
              <h3 className="text-sm font-semibold text-accent mb-1">
                c/{cloak.name || cloak.slug || cloak.address.slice(0, 10)}
              </h3>
              <p className="text-xs text-foreground-muted">
                {cloak.duel_count} duel{cloak.duel_count !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-foreground-muted">
                {cloak.vote_count.toLocaleString()} total votes
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
