import { useNavigate } from 'react-router-dom';
import type { AppNotification } from '@/lib/api/duelClient';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function typeIcon(type: string) {
  switch (type) {
    case 'comment_reply':
      return (
        <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      );
    case 'created_duel_ended':
      return (
        <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'stake_resolved':
      return (
        <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    default:
      return null;
  }
}

interface NotificationPanelProps {
  notifications: AppNotification[];
  onMarkAllRead: () => void;
  onMarkRead: (id: number) => void;
  onClose: () => void;
}

export function NotificationPanel({ notifications, onMarkAllRead, onMarkRead, onClose }: NotificationPanelProps) {
  const navigate = useNavigate();

  function handleClick(n: AppNotification) {
    if (!n.isRead) onMarkRead(n.id);
    if (n.duelSlug) {
      navigate(`/d/${n.duelSlug}`);
    }
    onClose();
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        <button
          onClick={onMarkAllRead}
          className="text-xs text-accent hover:underline"
        >
          Mark all read
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-foreground-muted">
            No notifications yet
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-4 py-3 hover:bg-background-secondary transition-colors flex items-start gap-3 ${
                !n.isRead ? 'bg-accent/5' : ''
              }`}
            >
              {typeIcon(n.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-snug line-clamp-2">{n.message}</p>
                <p className="text-xs text-foreground-muted mt-0.5">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.isRead && (
                <span className="w-2 h-2 rounded-full bg-accent shrink-0 mt-1.5" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
