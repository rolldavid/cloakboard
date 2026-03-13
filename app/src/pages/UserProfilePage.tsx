import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fetchUserProfile } from '@/lib/api/duelClient';
import type { UserProfile } from '@/lib/api/duelClient';
import { useAppStore, useThemeStore } from '@/store/index';

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
  const { userName: currentUserName, userAddress } = useAppStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwnProfile = username === currentUserName;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    fetchUserProfile(username, isOwnProfile && userAddress ? { address: userAddress } : undefined)
      .then(setProfile)
      .catch((err) => setError(err?.message || 'User not found'))
      .finally(() => setLoading(false));
  }, [username, isOwnProfile, userAddress]);

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
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <p className="text-foreground-muted">{error || 'User not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Username */}
      <div className="bg-card border border-border rounded-md p-6">
        <h1 className="text-xl font-bold text-foreground">{profile.username}</h1>
      </div>

      {/* Settings (own profile only) */}
      {isOwnProfile && <SettingsSection />}

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

function SettingsSection() {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-foreground">Settings</h2>
      </div>
      <div className="divide-y divide-border">
        {/* Theme */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-medium text-foreground">Appearance</div>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => theme === 'dark' && toggleTheme()}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                theme === 'light'
                  ? 'bg-accent text-white'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              Light
            </button>
            <button
              onClick={() => theme === 'light' && toggleTheme()}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-accent text-white'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              Dark
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
