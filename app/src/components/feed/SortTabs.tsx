import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FeedSort, TopTime } from '@/lib/api/feedClient';

interface Props {
  sort: FeedSort;
  time: TopTime;
  onSortChange: (sort: FeedSort) => void;
  onTimeChange: (time: TopTime) => void;
  /** Sort options to hide (e.g. ['ending_soon'] for cloak pages). */
  excludeSorts?: FeedSort[];
}

const SORT_OPTIONS: { value: FeedSort; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: 'hot', label: 'Hot' },
  { value: 'controversial', label: 'Controversial' },
  { value: 'ending_soon', label: 'Ending Soon' },
  { value: 'recently_concluded', label: 'Recently Concluded' },
  { value: 'top', label: 'Top' },
];

const TIME_OPTIONS: { value: TopTime; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function SortTabs({ sort, time, onSortChange, onTimeChange, excludeSorts }: Props) {
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (timeRef.current && !timeRef.current.contains(e.target as Node)) setTimeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Best';
  const currentTimeLabel = TIME_OPTIONS.find((o) => o.value === time)?.label ?? 'All Time';

  return (
    <div className="flex items-center gap-2">
      {/* Main sort dropdown */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-card border border-border hover:border-border-hover transition-colors"
        >
          {currentLabel}
          <ChevronDown open={open} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="absolute top-full left-0 mt-1 min-w-[160px] bg-card border border-border rounded-md shadow-lg z-50 py-1"
            >
              {SORT_OPTIONS.filter((o) => !excludeSorts?.includes(o.value)).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSortChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    sort === opt.value
                      ? 'bg-accent/10 text-accent'
                      : 'text-foreground hover:bg-card-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Time period dropdown — only when "Top" is selected */}
      {sort === 'top' && (
        <div className="relative" ref={timeRef}>
          <button
            onClick={() => setTimeOpen(!timeOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-card border border-border hover:border-border-hover transition-colors"
          >
            {currentTimeLabel}
            <ChevronDown open={timeOpen} />
          </button>
          <AnimatePresence>
            {timeOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="absolute top-full left-0 mt-1 min-w-[140px] bg-card border border-border rounded-md shadow-lg z-50 py-1"
              >
                {TIME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onTimeChange(opt.value);
                      setTimeOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      time === opt.value
                        ? 'bg-accent/10 text-accent'
                        : 'text-foreground hover:bg-card-hover'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
