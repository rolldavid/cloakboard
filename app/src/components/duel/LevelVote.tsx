import type { DuelLevel } from '@/lib/api/duelClient';

interface LevelVoteProps {
  levels: DuelLevel[];
  totalVotes: number;
  isActive: boolean;
  votedLevel?: number | null;
  onVote: (level: number) => void;
}

export function LevelVote({ levels, totalVotes, isActive, votedLevel, onVote }: LevelVoteProps) {
  const isLocked = votedLevel !== undefined && votedLevel !== null;

  return (
    <div className="space-y-2">
      {levels.map((lvl) => {
        const pct = totalVotes > 0 ? Math.round((lvl.voteCount / totalVotes) * 100) : 0;
        const isSelected = votedLevel === lvl.level;
        const canClick = isActive && !isLocked;

        return (
          <button
            key={lvl.level}
            onClick={() => canClick && onVote(lvl.level)}
            disabled={!canClick}
            className={`w-full text-left rounded-lg border p-3 transition-all ${
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
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isSelected ? 'bg-accent' : 'bg-vote-option/50'
                }`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
