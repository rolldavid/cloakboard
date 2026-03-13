import { useState, useEffect } from 'react';
import { fetchNotificationPreferences, updateNotificationPreferences } from '@/lib/api/duelClient';
import type { NotificationPreferences } from '@/lib/api/duelClient';

interface NotificationSettingsProps {
  onClose: () => void;
}

export function NotificationSettings({ onClose }: NotificationSettingsProps) {
  const [prefs, setPrefs] = useState<NotificationPreferences>({ commentReplies: true, createdDuelEnded: true });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotificationPreferences()
      .then(setPrefs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: keyof NotificationPreferences) {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    updateNotificationPreferences(updated).catch(() => {
      // Revert on failure
      setPrefs(prefs);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Notification Settings</h3>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="py-4 text-center text-sm text-foreground-muted">Loading...</div>
        ) : (
          <div className="space-y-3">
            <ToggleRow
              label="Comment replies"
              description="When someone replies to your comment"
              checked={prefs.commentReplies}
              onChange={() => toggle('commentReplies')}
            />
            <ToggleRow
              label="Duel ended"
              description="When a duel you created ends"
              checked={prefs.createdDuelEnded}
              onChange={() => toggle('createdDuelEnded')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-foreground-muted">{description}</div>
      </div>
      <button
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}
