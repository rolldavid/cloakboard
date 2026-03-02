import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/feedClient';
import type { UserProfile } from '@/lib/api/feedClient';
import { useAppStore } from '@/store/index';
import { getOptimisticPoints } from '@/lib/pointsTracker';

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
  const { userName: currentUserName } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwnProfile = username === currentUserName;
  const points = isOwnProfile ? getOptimisticPoints() : 0;

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
              to="/explore"
              className="inline-block text-sm font-medium text-accent hover:underline"
            >
              Explore communities &rarr;
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {profile.comments.map((comment) => (
              <Link
                key={comment.id}
                to={`/d/${comment.cloakSlug || comment.cloakAddress}/${comment.duelId}#comment-${comment.id}`}
                className="block px-4 py-3 hover:bg-background-secondary transition-colors"
              >
                <p className="text-sm text-foreground">{comment.body}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-foreground-muted">
                  <span>in</span>
                  <span className="text-accent">
                    c/{comment.cloakName || comment.cloakSlug || 'unknown'}
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
