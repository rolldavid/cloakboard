import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/duelClient';
import type { UserProfile } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';

interface Level {
  level: number;
  name: string;
  threshold: number;
}

const LEVELS: Level[] = [
  { level: 1, name: 'Observer',     threshold: 0 },
  { level: 2, name: 'Participant',  threshold: 10 },
  { level: 3, name: 'Contributor',  threshold: 50 },
  { level: 4, name: 'Debater',      threshold: 150 },
  { level: 5, name: 'Influencer',   threshold: 400 },
  { level: 6, name: 'Authority',    threshold: 1000 },
  { level: 7, name: 'Oracle',       threshold: 2500 },
  { level: 8, name: 'Architect',    threshold: 5000 },
  { level: 9, name: 'Sovereign',    threshold: 10000 },
];

function getLevelInfo(points: number) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (points >= lvl.threshold) current = lvl;
    else break;
  }
  const nextIndex = LEVELS.findIndex((l) => l.level === current.level) + 1;
  const next = nextIndex < LEVELS.length ? LEVELS[nextIndex] : null;
  const progressInLevel = next
    ? (points - current.threshold) / (next.threshold - current.threshold)
    : 1;
  return { current, next, progressInLevel, pointsToNext: next ? next.threshold - points : 0 };
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

export function UserProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { userName: currentUserName, whisperPoints } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwnProfile = username === currentUserName;
  const points = isOwnProfile ? whisperPoints : 0;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    fetchUserProfile(username)
      .then(setProfile)
      .catch((err) => setError(err?.message || 'User not found'))
      .finally(() => setLoading(false));
  }, [username]);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="space-y-4"
      >
        <div className="bg-card border border-border rounded-md p-6 animate-pulse">
          <div className="h-6 bg-background-tertiary rounded w-1/3 mb-2" />
          <div className="h-4 bg-background-tertiary rounded w-1/4" />
        </div>
      </motion.div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <Link to="/" className="text-sm text-foreground-muted hover:text-foreground">&larr; Back</Link>
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <p className="text-foreground-muted">{error || 'User not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to="/" className="text-sm text-foreground-muted hover:text-foreground">&larr; Back</Link>

      {/* Profile header */}
      <div className="bg-card border border-border rounded-md p-6">
        <h1 className="text-xl font-bold text-foreground">{profile.username}</h1>
        {isOwnProfile ? (
          <p className="text-sm text-foreground-muted mt-1">
            {points.toLocaleString()} whisper points
          </p>
        ) : (
          <p className="text-sm text-foreground-muted mt-1">Whisper points are private</p>
        )}
      </div>

      {/* Level progress — own profile only */}
      {isOwnProfile && <LevelProgress points={points} />}

      {/* Recent Comments */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Recent Comments</h2>
        </div>
        {profile.comments.length === 0 ? (
          <div className="px-4 py-8 text-center space-y-3">
            <p className="text-sm text-foreground-muted">
              Vote on duels and join the conversation to earn your first whisper points.
            </p>
            <Link
              to="/"
              className="inline-block text-sm font-medium text-accent hover:underline"
            >
              Browse duels &rarr;
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profile.comments.map((comment) => (
              <Link
                key={comment.id}
                to={`/d/${comment.duelSlug}#comment-${comment.id}`}
                className="block px-4 py-3 hover:bg-background-secondary transition-colors"
              >
                <p className="text-sm text-foreground">{comment.body}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                  <span>in</span>
                  <span className="text-accent">
                    {comment.subcategoryName || 'General'}
                  </span>
                  <span>·</span>
                  <span>{timeAgo(comment.createdAt)}</span>
                  <span>·</span>
                  <span className={comment.score >= 0 ? 'text-status-success' : 'text-status-error'}>
                    {comment.score > 0 ? '+' : ''}{comment.score}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LevelProgress({ points }: { points: number }) {
  const { current, next, progressInLevel, pointsToNext } = useMemo(
    () => getLevelInfo(points),
    [points],
  );

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Level {current.level} — {current.name}
          </h2>
          {next ? (
            <p className="text-xs text-foreground-muted mt-0.5">
              {pointsToNext.toLocaleString()} points to {next.name}
            </p>
          ) : (
            <p className="text-xs text-foreground-muted mt-0.5">Max level reached</p>
          )}
        </div>
        <span className="text-2xl font-bold text-accent tabular-nums">
          {current.level}
        </span>
      </div>

      {/* Progress bar */}
      {next && (
        <div className="mb-5">
          <div className="h-2 bg-surface-hover rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={false}
              animate={{ width: `${Math.max(progressInLevel * 100, 2)}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-foreground-muted tabular-nums">
            <span>{current.threshold.toLocaleString()}</span>
            <span>{next.threshold.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Level timeline */}
      <div className="relative">
        {LEVELS.map((lvl, i) => {
          const reached = points >= lvl.threshold;
          const isCurrent = lvl.level === current.level;
          const isLast = i === LEVELS.length - 1;

          return (
            <div key={lvl.level} className="flex items-start gap-3 relative">
              {/* Vertical line */}
              {!isLast && (
                <div
                  className={`absolute left-[9px] top-5 w-0.5 h-full ${
                    reached && points >= (LEVELS[i + 1]?.threshold ?? Infinity)
                      ? 'bg-accent'
                      : reached
                        ? 'bg-gradient-to-b from-accent to-border'
                        : 'bg-border'
                  }`}
                />
              )}

              {/* Dot */}
              <div
                className={`relative z-10 w-[19px] h-[19px] rounded-full border-2 shrink-0 flex items-center justify-center ${
                  isCurrent
                    ? 'border-accent bg-accent'
                    : reached
                      ? 'border-accent bg-accent/20'
                      : 'border-border bg-surface'
                }`}
              >
                {reached && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>

              {/* Label */}
              <div className={`pb-4 ${isCurrent ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${reached ? 'text-foreground' : 'text-foreground-muted'}`}>
                    {lvl.name}
                  </span>
                  <span className="text-[10px] text-foreground-muted tabular-nums">
                    Lv. {lvl.level}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted">
                  {lvl.threshold === 0 ? 'Starting level' : `${lvl.threshold.toLocaleString()} points`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
