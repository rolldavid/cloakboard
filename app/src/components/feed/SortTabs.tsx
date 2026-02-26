import type { FeedSort, TopTime } from '@/lib/api/feedClient';

interface Props {
  sort: FeedSort;
  time: TopTime;
  onSortChange: (sort: FeedSort) => void;
  onTimeChange: (time: TopTime) => void;
}

const SORT_OPTIONS: { value: FeedSort; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: 'hot', label: 'Hot' },
  { value: 'controversial', label: 'Controversial' },
  { value: 'ending_soon', label: 'Ending Soon' },
  { value: 'top', label: 'Top' },
];

const TIME_OPTIONS: { value: TopTime; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];

export function SortTabs({ sort, time, onSortChange, onTimeChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSortChange(opt.value)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${
              sort === opt.value
                ? 'bg-accent text-white'
                : 'text-foreground-muted hover:text-foreground hover:bg-card-hover'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {sort === 'top' && (
        <div className="flex gap-1 overflow-x-auto">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onTimeChange(opt.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                time === opt.value
                  ? 'bg-accent/10 text-accent'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
