import { useState, useEffect, useRef } from 'react';
import { VoteButtons } from './VoteButtons';
import type { DuelInfo } from '@/lib/templates/duelTypes';

interface ActiveDuelCardProps {
  duel: DuelInfo;
  isLoggedIn: boolean;
  service: any;
  onVoted: () => void;
}

export function ActiveDuelCard({ duel, isLoggedIn, service, onVoted }: ActiveDuelCardProps) {
  const [hasVoted, setHasVoted] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [provingElapsed, setProvingElapsed] = useState(0);
  const provingStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVoting) { provingStartRef.current = null; return; }
    const interval = setInterval(() => {
      if (provingStartRef.current) setProvingElapsed(Math.floor((Date.now() - provingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isVoting]);

  const handleVote = (support: boolean) => {
    if (!service || hasVoted || isVoting) return;

    setHasVoted(true);
    setIsVoting(true);
    setVoteError(null);
    setProvingElapsed(0);
    provingStartRef.current = Date.now();

    service.castVote(duel.id, support)
      .then(() => onVoted())
      .catch((err: any) => {
        const msg = err?.message ?? '';
        if (msg.includes('nullifier') || msg.includes('already')) {
          setVoteError('You have already voted on this duel.');
        } else {
          setHasVoted(false);
          setVoteError(msg || 'Vote failed — please try again');
        }
      })
      .finally(() => setIsVoting(false));
  };

  const statementText = duel.statementText?.replace(/\0/g, '').trim() || '(No statement)';
  const isActive = !duel.isTallied;
  const showBreakdown = duel.isTallied || duel.agreeVotes > 0 || duel.disagreeVotes > 0;

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    return m === 0 ? `${s}s` : `${m}m ${(s % 60).toString().padStart(2, '0')}s`;
  };

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-6 py-3 bg-accent/10 border-b border-accent/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-status-success animate-pulse' : 'bg-foreground-muted'}`} />
          <span className="text-sm font-medium text-accent">
            {isActive ? 'Active Duel' : 'Duel Ended'}
          </span>
          <span className="text-xs text-foreground-muted">#{duel.id}</span>
        </div>
      </div>

      <div className="px-6 py-8 text-center">
        <p className="text-2xl font-bold text-foreground leading-relaxed">
          {statementText}
        </p>
      </div>

      <div className="px-6 pb-4 text-center">
        <p className="text-sm text-foreground-muted">
          {duel.totalVotes} vote{duel.totalVotes !== 1 ? 's' : ''} cast
        </p>
      </div>

      {isActive && isLoggedIn && !hasVoted && (
        <div className="px-6 pb-6">
          <VoteButtons onVote={handleVote} isVoting={isVoting} disabled={hasVoted} />
        </div>
      )}

      {hasVoted && (
        <div className="px-6 pb-6 text-center">
          {isVoting ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground-muted font-medium flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Securing your vote...
              </p>
              <p className="text-xs text-foreground-muted">
                {formatElapsed(provingElapsed)} — this takes several minutes
              </p>
            </div>
          ) : (
            <p className="text-sm text-status-success font-medium">Vote confirmed</p>
          )}
        </div>
      )}

      {voteError && (
        <div className="px-6 pb-4">
          <p className="text-sm text-status-error text-center">{voteError}</p>
        </div>
      )}

      {showBreakdown && (
        <div className="px-6 pb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-status-success font-medium">Agree: {duel.agreeVotes}</span>
            <span className="text-status-error font-medium">Disagree: {duel.disagreeVotes}</span>
          </div>
          <div className="h-3 bg-background-tertiary rounded-full overflow-hidden flex">
            <div className="bg-status-success transition-all duration-500"
              style={{ width: `${duel.totalVotes > 0 ? (duel.agreeVotes / duel.totalVotes) * 100 : 50}%` }} />
            <div className="bg-status-error transition-all duration-500"
              style={{ width: `${duel.totalVotes > 0 ? (duel.disagreeVotes / duel.totalVotes) * 100 : 50}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
