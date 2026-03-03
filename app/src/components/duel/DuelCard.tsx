import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import type { Duel } from '@/lib/api/duelClient';
import { useAppStore } from '@/store';
import { useCountdown } from '@/hooks/useCountdown';
import { applyOptimisticVoteToDuel } from '@/lib/voteTracker';

interface DuelCardProps {
  duel: Duel;
  onVote?: (duelId: number, direction: boolean) => void;
}

export function DuelCard({ duel: rawDuel, onVote }: DuelCardProps) {
  const duel = applyOptimisticVoteToDuel(rawDuel);
  const navigate = useNavigate();
  const { isAuthenticated, userAddress } = useAppStore();
  const [hoveredVote, setHoveredVote] = useState<'agree' | 'disagree' | null>(null);
  const { timeLeft, isClosing, hasEnded } = useCountdown(duel.endBlock);

  // Restore voted state from localStorage, scoped per user
  const [userVote, setUserVote] = useState<boolean | null>(null);
  const [userVotedOption, setUserVotedOption] = useState<number | null>(null);
  const [userVotedLevel, setUserVotedLevel] = useState<number | null>(null);

  useEffect(() => {
    if (!userAddress) { setUserVote(null); setUserVotedOption(null); setUserVotedLevel(null); return; }
    try {
      const dir = localStorage.getItem(`duelcloak_voted_dir_${userAddress}_${duel.id}`);
      if (dir !== null) setUserVote(dir === '1');
      else setUserVote(null);
      const opt = localStorage.getItem(`duelcloak_voted_opt_${userAddress}_${duel.id}`);
      setUserVotedOption(opt ? parseInt(opt, 10) : null);
      const lvl = localStorage.getItem(`duelcloak_voted_lvl_${userAddress}_${duel.id}`);
      setUserVotedLevel(lvl ? parseInt(lvl, 10) : null);
    } catch { setUserVote(null); setUserVotedOption(null); setUserVotedLevel(null); }
  }, [userAddress, duel.id]);

  const total = duel.totalVotes || 0;
  const agreePct = total > 0 ? Math.round((duel.agreeCount / total) * 100) : 50;
  const disagreePct = 100 - agreePct;

  // Get top 2 options for multi cards
  const topOptions = duel.options
    ? [...duel.options].sort((a, b) => b.voteCount - a.voteCount).slice(0, 2)
    : [];

  // Get top 2 levels for level cards
  const topLevels = duel.levels
    ? [...duel.levels].sort((a, b) => b.voteCount - a.voteCount).slice(0, 2)
    : [];

  const handleVote = (direction: boolean) => {
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duel.slug}`);
      navigate('/login');
      return;
    }
    onVote?.(duel.id, direction);
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-4 hover:border-border-hover transition-colors flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-accent font-medium">
          {duel.subcategoryName || duel.categoryName || 'General'}
        </span>
        {timeLeft && (
          <span className={`text-xs ${hasEnded ? 'text-foreground-muted' : isClosing ? 'text-red-400' : 'text-foreground-secondary'}`}>
            {hasEnded ? 'Ended' : timeLeft}
          </span>
        )}
      </div>

      {/* Title — always links to detail page */}
      <Link to={`/d/${duel.slug}`} className="block mb-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2 hover:text-accent transition-colors">
          {duel.title}
        </h3>
      </Link>

      {/* Vote bars */}
      <div className="space-y-1.5 mb-3 flex-1">
        {duel.duelType === 'binary' ? (
          <>
            <VoteBar label="Agree" pct={agreePct} color="green" hovered={hoveredVote === 'agree'} />
            <VoteBar label="Disagree" pct={disagreePct} color="red" hovered={hoveredVote === 'disagree'} />
          </>
        ) : duel.duelType === 'level' && topLevels.length > 0 ? (
          topLevels.map((lvl) => {
            const lvlPct = total > 0 ? Math.round((lvl.voteCount / total) * 100) : 0;
            return (
              <VoteBar key={lvl.level} label={lvl.label || `Level ${lvl.level}`} pct={lvlPct} color="blue" />
            );
          })
        ) : duel.duelType === 'multi' && topOptions.length > 0 ? (
          topOptions.map((opt) => {
            const optPct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0;
            return (
              <VoteBar key={opt.id} label={opt.label} pct={optPct} color="blue" />
            );
          })
        ) : total > 0 ? (
          <div className="flex items-center h-5 text-xs text-foreground-muted">
            {total} vote{total !== 1 ? 's' : ''} cast
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <div className="flex items-center gap-3">
          <span>{duel.commentCount} comments</span>
          <span>{total} votes</span>
          {duel.duelType === 'multi' && duel.options && duel.options.length > 2 && (
            <span>+{duel.options.length - 2} more</span>
          )}
          {duel.duelType === 'level' && duel.levels && duel.levels.length > 2 && (
            <span>+{duel.levels.length - 2} more</span>
          )}
        </div>
        {duel.duelType === 'binary' && (
          <span className="text-[10px] uppercase tracking-wider font-medium text-foreground-muted">
            {duel.duelType}
          </span>
        )}
        {duel.duelType !== 'binary' && (
          <span className="text-[10px] uppercase tracking-wider font-medium text-foreground-muted">
            {duel.duelType === 'multi' ? 'Multi' : 'Level'}
          </span>
        )}
      </div>

      {/* Inline vote buttons (binary only) */}
      {duel.duelType === 'binary' && duel.status === 'active' && !hasEnded && (
        isClosing ? (
          <div className="mt-3 pt-3 border-t border-border text-center text-xs text-red-400 font-medium">
            Voting closing soon...
          </div>
        ) : userVote !== null ? (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            <div
              className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center ${
                userVote ? 'bg-vote-agree/20 text-vote-agree border border-vote-agree/40' : 'text-foreground-muted border border-border opacity-50'
              }`}
            >
              {userVote ? 'Agreed' : 'Agree'}
            </div>
            <div
              className={`flex-1 py-1.5 text-xs font-medium rounded-md text-center ${
                !userVote ? 'bg-vote-disagree/20 text-vote-disagree border border-vote-disagree/40' : 'text-foreground-muted border border-border opacity-50'
              }`}
            >
              {!userVote ? 'Disagreed' : 'Disagree'}
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mt-3 pt-3 border-t border-border">
            <button
              onMouseEnter={() => setHoveredVote('agree')}
              onMouseLeave={() => setHoveredVote(null)}
              onClick={() => handleVote(true)}
              className="flex-1 py-1.5 text-xs font-medium rounded-md border border-vote-agree/30 text-vote-agree hover:bg-vote-agree/10 transition-colors"
            >
              Agree
            </button>
            <button
              onMouseEnter={() => setHoveredVote('disagree')}
              onMouseLeave={() => setHoveredVote(null)}
              onClick={() => handleVote(false)}
              className="flex-1 py-1.5 text-xs font-medium rounded-md border border-vote-disagree/30 text-vote-disagree hover:bg-vote-disagree/10 transition-colors"
            >
              Disagree
            </button>
          </div>
        )
      )}

      {/* Click to detail (non-binary) */}
      {duel.duelType !== 'binary' && duel.status === 'active' && !hasEnded && (
        isClosing ? (
          <div className="mt-3 pt-3 border-t border-border text-center text-xs text-red-400 font-medium">
            Voting closing soon...
          </div>
        ) : (userVotedOption !== null || userVotedLevel !== null) ? (
          <div className="mt-3 pt-3 border-t border-border text-center text-xs font-medium text-foreground-muted">
            Voted
          </div>
        ) : (
          <Link
            to={`/d/${duel.slug}`}
            className="block mt-3 pt-3 border-t border-border text-center text-xs font-medium text-accent hover:text-accent-hover transition-colors"
          >
            Vote on this
          </Link>
        )
      )}
    </div>
  );
}

function VoteBar({ label, pct, color, hovered }: { label: string; pct: number; color: 'green' | 'red' | 'blue'; hovered?: boolean }) {
  const barColors = {
    green: hovered ? 'bg-vote-agree' : 'bg-vote-agree/60',
    red: hovered ? 'bg-vote-disagree' : 'bg-vote-disagree/60',
    blue: 'bg-vote-option/60',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-5 bg-surface-hover rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColors[color]}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
        <span className="absolute inset-0 flex items-center px-2 text-[11px] font-medium text-foreground">
          {pct}% {label}
        </span>
      </div>
    </div>
  );
}
