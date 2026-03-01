import { Link, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import type { FeedDuel } from '@/lib/api/feedClient';
import { useAppStore } from '@/store/index';
import { voteDuel } from '@/lib/api/feedClient';
import { useState } from 'react';

function timeRemaining(endTimeStr: string | null): string | null {
  if (!endTimeStr) return null;
  const ms = new Date(endTimeStr).getTime() - Date.now();
  if (ms <= 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return remainMin > 0 ? `${hours}h ${remainMin}m left` : `${hours}h left`;
  const days = Math.floor(hours / 24);
  const remainHrs = hours % 24;
  return remainHrs > 0 ? `${days}d ${remainHrs}h left` : `${days}d left`;
}

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
  onQualityVote?: (duelId: number, qualityUpvotes: number, qualityDownvotes: number) => void;
}

export function DuelFeedCard({ duel, onQualityVote }: Props) {
  const navigate = useNavigate();
  const { userAddress, userName, isAuthenticated } = useAppStore();
  const [qualityUp, setQualityUp] = useState(duel.qualityUpvotes ?? 0);
  const [qualityDown, setQualityDown] = useState(duel.qualityDownvotes ?? 0);
  const [myQualityVote, setMyQualityVote] = useState<1 | -1 | null>(duel.myQualityVote ?? null);

  const agreePercent = duel.totalVotes > 0 ? Math.round((duel.agreeVotes / duel.totalVotes) * 100) : 50;
  const disagreePercent = 100 - agreePercent;
  const isActive = !duel.isTallied;
  const statementText = duel.statementText?.replace(/\0/g, '').trim() || '(No statement)';

  const remaining = isActive ? timeRemaining(duel.endTime) : null;
  const timerExpired = isActive && duel.endTime && new Date(duel.endTime).getTime() <= Date.now();

  const handleQualityVote = async (e: React.MouseEvent, dir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      sessionStorage.setItem('returnTo', `/d/${duel.cloakSlug}/${duel.duelId}`);
      navigate('/login');
      return;
    }
    if (!userAddress || !userName) return;

    const oldVote = myQualityVote;
    const oldUp = qualityUp;
    const oldDown = qualityDown;

    // Optimistic update
    const newVote = oldVote === dir ? null : dir;
    let newUp = oldUp;
    let newDown = oldDown;
    if (oldVote === 1) newUp--;
    if (oldVote === -1) newDown--;
    if (newVote === 1) newUp++;
    if (newVote === -1) newDown++;

    setMyQualityVote(newVote);
    setQualityUp(newUp);
    setQualityDown(newDown);

    try {
      const result = await voteDuel(
        { address: userAddress, name: userName },
        duel.cloakAddress,
        duel.duelId,
        oldVote === dir ? 0 : dir,
      );
      setQualityUp(result.qualityUpvotes);
      setQualityDown(result.qualityDownvotes);
      setMyQualityVote(result.myVote);
      onQualityVote?.(duel.duelId, result.qualityUpvotes, result.qualityDownvotes);
    } catch {
      setMyQualityVote(oldVote);
      setQualityUp(oldUp);
      setQualityDown(oldDown);
    }
  };

  const qualityScore = qualityUp - qualityDown;
  const qualitySpring = useSpring(qualityScore, { stiffness: 100, damping: 20 });
  const qualityDisplay = useTransform(qualitySpring, (v) => {
    const rounded = Math.round(v);
    return rounded > 0 ? `+${rounded}` : `${rounded}`;
  });
  useEffect(() => { qualitySpring.set(qualityScore); }, [qualityScore, qualitySpring]);

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
        <span className="text-foreground-muted text-xs">
          {remaining ?? timeAgo(duel.createdAt)}
        </span>
        <span className="text-foreground-muted">·</span>
        <span className={`flex items-center gap-1 text-xs font-medium ${isActive ? 'text-status-success' : 'text-foreground-muted'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-status-success animate-pulse' : 'bg-foreground-muted'}`} />
          {isActive ? 'Active' : 'Concluded'}
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
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => handleQualityVote(e, 1)}
            className={`hover:text-status-success transition-colors ${myQualityVote === 1 ? 'text-status-success font-bold' : ''}`}
          >
            &uarr;
          </button>
          <motion.span className={`font-medium ${qualityScore > 0 ? 'text-status-success' : qualityScore < 0 ? 'text-status-error' : ''}`}>
            {qualityDisplay}
          </motion.span>
          <button
            onClick={(e) => handleQualityVote(e, -1)}
            className={`hover:text-status-error transition-colors ${myQualityVote === -1 ? 'text-status-error font-bold' : ''}`}
          >
            &darr;
          </button>
        </div>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          {duel.commentCount}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          {duel.totalVotes} votes
        </span>
        {isActive && remaining && (
          <span className="ml-auto text-accent font-medium">{remaining}</span>
        )}
        {isActive && timerExpired && (
          <span className="ml-auto text-accent font-medium">Ending soon...</span>
        )}
        {isActive && !remaining && !timerExpired && (
          <span className="ml-auto text-accent font-medium">Active</span>
        )}
        {!isActive && (
          <span className="ml-auto">Concluded</span>
        )}
      </div>
    </div>
  );
}
