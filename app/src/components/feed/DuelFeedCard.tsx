import { Link, useNavigate } from 'react-router-dom';
import type { FeedDuel } from '@/lib/api/feedClient';
import { useAppStore } from '@/store/index';
import { starDuel, unstarDuel } from '@/lib/api/feedClient';
import { useState } from 'react';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface Props {
  duel: FeedDuel;
  onStarToggle?: (duelId: number, starred: boolean) => void;
}

export function DuelFeedCard({ duel, onStarToggle }: Props) {
  const navigate = useNavigate();
  const { userAddress, userName, isAuthenticated } = useAppStore();
  const [starred, setStarred] = useState(duel.isStarred);
  const [starCount, setStarCount] = useState(duel.starCount);

  const agreePercent = duel.totalVotes > 0 ? Math.round((duel.agreeVotes / duel.totalVotes) * 100) : 50;
  const disagreePercent = 100 - agreePercent;
  const isActive = !duel.isTallied;
  const statementText = duel.statementText?.replace(/\0/g, '').trim() || '(No statement)';

  const handleStarClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated || !userAddress || !userName) return;

    const wasStarred = starred;
    // Optimistic update
    setStarred(!wasStarred);
    setStarCount((c) => (wasStarred ? c - 1 : c + 1));

    try {
      const user = { address: userAddress, name: userName };
      if (wasStarred) {
        await unstarDuel(user, duel.cloakAddress, duel.duelId);
      } else {
        await starDuel(user, duel.cloakAddress, duel.duelId);
      }
      onStarToggle?.(duel.duelId, !wasStarred);
    } catch {
      // Revert
      setStarred(wasStarred);
      setStarCount((c) => (wasStarred ? c + 1 : c - 1));
    }
  };

  return (
    <div
      onClick={() => navigate(`/d/${duel.cloakSlug || duel.cloakAddress}/${duel.duelId}`)}
      className="block bg-card border border-border rounded-md hover:border-border-hover transition-colors cursor-pointer"
    >
      {/* Top row */}
      <div className="px-4 py-2.5 flex items-center gap-2 text-sm">
        <Link
          to={`/c/${duel.cloakSlug || duel.cloakAddress}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-accent hover:underline"
        >
          c/{duel.cloakName || duel.cloakSlug || duel.cloakAddress.slice(0, 10)}
        </Link>
        <span className="text-foreground-muted">·</span>
        <span className="text-foreground-muted text-xs">{timeAgo(duel.createdAt)}</span>
        <span className="text-foreground-muted">·</span>
        <span className={`flex items-center gap-1 text-xs font-medium ${isActive ? 'text-status-success' : 'text-foreground-muted'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-status-success animate-pulse' : 'bg-foreground-muted'}`} />
          {isActive ? 'Active' : 'Ended'}
        </span>
      </div>

      {/* Statement */}
      <div className="px-4 pb-3">
        <p className="text-base font-semibold text-foreground leading-snug">
          {statementText}
        </p>
      </div>

      {/* Vote bar */}
      {duel.totalVotes > 0 && (
        <div className="px-4 pb-3">
          <div className="h-2 bg-background-tertiary rounded-full overflow-hidden flex">
            <div className="bg-status-success transition-all duration-300" style={{ width: `${agreePercent}%` }} />
            <div className="bg-status-error transition-all duration-300" style={{ width: `${disagreePercent}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-xs text-foreground-muted">
            <span>{agreePercent}% Agree</span>
            <span>{disagreePercent}% Disagree</span>
          </div>
        </div>
      )}

      {/* Bottom row */}
      <div className="px-4 py-2.5 border-t border-border flex items-center gap-4 text-xs text-foreground-muted">
        <button
          onClick={handleStarClick}
          className={`flex items-center gap-1 hover:text-accent transition-colors ${starred ? 'text-accent' : ''}`}
        >
          {starred ? '\u2605' : '\u2606'} {starCount}
        </button>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          {duel.commentCount}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          {duel.totalVotes} votes
        </span>
        {isActive && (
          <span className="ml-auto text-accent font-medium">Active</span>
        )}
        {!isActive && (
          <span className="ml-auto">Ended</span>
        )}
      </div>
    </div>
  );
}
