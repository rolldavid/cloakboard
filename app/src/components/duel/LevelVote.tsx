import type { DuelLevel } from '@/lib/api/duelClient';
import { motion } from 'framer-motion';

interface LevelVoteProps {
  levels: DuelLevel[];
  totalVotes: number;
  isActive: boolean;
  votedLevel?: number | null;
  onVote: (level: number) => void;
}

function wagerColor(stake: number): string {
  if (stake >= 60) return 'text-red-400';
  if (stake >= 30) return 'text-amber-400';
  return 'text-green-400';
}

function WagerHeader() {
  return (
    <div className="group relative text-[10px] uppercase tracking-wider text-foreground-muted font-medium text-center cursor-help flex items-center justify-center gap-0.5">
      Wager
      <svg className="w-3 h-3 text-foreground-muted/60" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.75 7h1.5v4.5h-1.5V7z" />
      </svg>
      <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 px-2.5 py-1.5 text-xs normal-case tracking-normal text-foreground bg-background border border-border rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
        Cost to vote. Winning side gets 100 pts.
      </div>
    </div>
  );
}

export function LevelVote({ levels, totalVotes, isActive, votedLevel, onVote }: LevelVoteProps) {
  const isLocked = votedLevel !== undefined && votedLevel !== null;
  const showWager = true;

  return (
    <div className="space-y-2">
      {/* Wager column header */}
      {showWager && (
        <div className="flex items-end gap-2">
          <div className="flex-1" />
          <div className="w-16 shrink-0 pb-0.5">
            <WagerHeader />
          </div>
        </div>
      )}

      {levels.map((lvl) => {
        const pct = totalVotes > 0 ? Math.round((lvl.voteCount / totalVotes) * 100) : 0;
        const isSelected = votedLevel === lvl.level;
        const canClick = isActive && !isLocked;
        const stake = totalVotes === 0 ? 50 : Math.max(5, Math.round(100 * lvl.voteCount / totalVotes));

        return (
          <div key={lvl.level} className="flex items-stretch gap-2">
            <button
              onClick={() => canClick && onVote(lvl.level)}
              disabled={!canClick}
              className={`flex-1 text-left rounded-lg border p-3 transition-all ${
                isSelected
                  ? 'border-accent bg-accent/10'
                  : isLocked
                  ? 'border-border opacity-60 cursor-default'
                  : canClick
                  ? 'border-border hover:border-accent/50 cursor-pointer'
                  : 'border-border opacity-60 cursor-default'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-sm font-medium ${
                  isSelected ? 'text-accent' : 'text-foreground'
                }`}>
                  {lvl.label || `Level ${lvl.level}`}
                </span>
                <span className={`text-sm font-medium ${
                  isSelected ? 'text-accent' : 'text-foreground-muted'
                }`}>
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    isSelected ? 'bg-accent' : 'bg-vote-option/50'
                  }`}
                  initial={false}
                  animate={{ width: `${Math.max(pct, 1)}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </button>

            {/* Wager amount column */}
            {showWager && (
              <div className={`w-16 shrink-0 flex items-center justify-center rounded-lg border border-border bg-surface-hover/50 ${wagerColor(stake)}`}>
                <span className="text-sm font-bold tabular-nums">{stake}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
