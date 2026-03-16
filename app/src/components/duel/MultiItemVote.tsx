import { useState } from 'react';
import type { DuelOption } from '@/lib/api/duelClient';
import { addDuelOption } from '@/lib/api/duelClient';
import { useAppStore } from '@/store';
import { motion } from 'framer-motion';

interface MultiItemVoteProps {
  duelId: number;
  options: DuelOption[];
  totalVotes: number;
  isActive: boolean;
  votedOptionId?: number | null;
  createdBy?: string | null;
  onVote: (optionId: number) => void;
  onOptionAdded: () => void;
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

export function MultiItemVote({
  duelId, options, totalVotes, isActive, votedOptionId, createdBy, onVote, onOptionAdded,
}: MultiItemVoteProps) {
  const { isAuthenticated, userAddress, userName } = useAppStore();
  const [newOption, setNewOption] = useState('');
  const [adding, setAdding] = useState(false);

  const sorted = [...options].sort((a, b) => b.voteCount - a.voteCount);
  const isLocked = votedOptionId !== undefined && votedOptionId !== null;
  const showWager = !isLocked;

  const handleAddOption = async () => {
    if (!newOption.trim() || !userAddress || !userName) return;
    setAdding(true);
    try {
      await addDuelOption({ address: userAddress, name: userName }, duelId, newOption.trim());
      setNewOption('');
      onOptionAdded();
    } catch (err: any) {
      console.error('Failed to add option:', err?.message);
    } finally {
      setAdding(false);
    }
  };

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

      {sorted.map((opt) => {
        const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
        const isVoted = votedOptionId === opt.id;
        const stake = totalVotes === 0 ? 50 : Math.max(5, Math.round(100 * opt.voteCount / totalVotes));

        return (
          <div key={opt.id} className="flex items-stretch gap-2">
            <motion.button
              layout
              transition={{ duration: 0.3 }}
              onClick={() => !isLocked && isActive && onVote(opt.id)}
              disabled={isLocked || !isActive}
              className={`flex-1 relative flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                isVoted
                  ? 'border-accent bg-accent/10'
                  : isLocked
                  ? 'border-border opacity-60 cursor-default'
                  : 'border-border hover:border-border-hover cursor-pointer'
              }`}
            >
              <div className="flex-1 relative z-10">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${isVoted ? 'text-accent' : 'text-foreground'}`}>
                    {opt.label}
                  </span>
                  <span className="text-xs text-foreground-muted">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      isVoted ? 'bg-accent' : 'bg-vote-option/50'
                    }`}
                    initial={false}
                    animate={{ width: `${Math.max(pct, 1)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-0.5 text-xs text-foreground-muted">
                  {opt.voteCount} votes
                </div>
              </div>
              {isVoted && (
                <svg className="w-5 h-5 text-accent shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </motion.button>

            {/* Wager amount column */}
            {showWager && (
              <div className={`w-16 shrink-0 flex items-center justify-center rounded-lg border border-border bg-surface-hover/50 ${wagerColor(stake)}`}>
                <span className="text-sm font-bold tabular-nums">{stake}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Add option */}
      {isActive && isAuthenticated && options.length < 50 && createdBy === userAddress && (
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            placeholder="Add an option..."
            maxLength={200}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            onKeyDown={(e) => e.key === 'Enter' && handleAddOption()}
          />
          <button
            onClick={handleAddOption}
            disabled={adding || !newOption.trim()}
            className="px-4 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50"
          >
            {adding ? '...' : 'Add'}
          </button>
        </div>
      )}
    </div>
  );
}
