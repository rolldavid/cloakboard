import { useState } from 'react';
import type { DuelOption } from '@/lib/api/duelClient';
import { addDuelOption } from '@/lib/api/duelClient';
import { useAppStore } from '@/store';

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

export function MultiItemVote({
  duelId, options, totalVotes, isActive, votedOptionId, createdBy, onVote, onOptionAdded,
}: MultiItemVoteProps) {
  const { isAuthenticated, userAddress, userName } = useAppStore();
  const [newOption, setNewOption] = useState('');
  const [adding, setAdding] = useState(false);

  const sorted = [...options].sort((a, b) => b.voteCount - a.voteCount);

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
      {sorted.map((opt, i) => {
        const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
        const isVoted = votedOptionId === opt.id;
        const isLocked = votedOptionId !== undefined && votedOptionId !== null;

        return (
          <button
            key={opt.id}
            onClick={() => !isLocked && isActive && onVote(opt.id)}
            disabled={isLocked || !isActive}
            className={`w-full relative flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
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
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isVoted ? 'bg-accent' : 'bg-vote-option/50'
                  }`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
              <div className="mt-0.5 text-xs text-foreground-muted">{opt.voteCount} votes</div>
            </div>
            {isVoted && (
              <svg className="w-5 h-5 text-accent shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
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
