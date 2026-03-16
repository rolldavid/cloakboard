/**
 * Local (client-side) notifications for market voting rewards.
 *
 * Market win/loss notifications are purely client-side because the server
 * never learns vote direction (privacy). These are stored in localStorage
 * and merged with server notifications in useNotifications.
 */

const STORAGE_KEY_PREFIX = 'dc_notifs_';
const MAX_LOCAL_NOTIFICATIONS = 50;

let _activeAddr: string | null = null;

/** Set the active user address for notification scoping. Call on login. */
export function setNotificationUser(addr: string | null): void {
  _activeAddr = addr;
}

function storageKey(): string {
  return _activeAddr ? `${STORAGE_KEY_PREFIX}${_activeAddr}` : `${STORAGE_KEY_PREFIX}none`;
}

export interface LocalNotification {
  id: string; // "local-{timestamp}-{random}"
  type: 'market_win' | 'market_loss';
  duelId: number;
  dbDuelId?: number;
  message: string;
  stakeAmount: number;
  rewardAmount: number; // 100 for win, 0 for loss
  isRead: boolean;
  createdAt: string; // ISO string
  slug?: string;
  title?: string;
}

// Listeners for reactive updates
type LocalNotificationListener = () => void;
const _listeners = new Set<LocalNotificationListener>();

export function onLocalNotificationsChanged(fn: LocalNotificationListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

function generateId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getLocalNotifications(): LocalNotification[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalNotifications(notifications: LocalNotification[]): void {
  try {
    // Keep only the most recent notifications
    const trimmed = notifications.slice(0, MAX_LOCAL_NOTIFICATIONS);
    localStorage.setItem(storageKey(), JSON.stringify(trimmed));
  } catch { /* localStorage full */ }
}

export function addLocalNotification(
  type: LocalNotification['type'],
  duelId: number,
  stakeAmount: number,
  rewardAmount: number,
  slug?: string,
  title?: string,
  dbDuelId?: number,
): void {
  const messages: Record<LocalNotification['type'], string> = {
    market_win: `You won! +${rewardAmount} pts earned`,
    market_loss: `Your ${stakeAmount} pt stake was burned`,
  };

  const notification: LocalNotification = {
    id: generateId(),
    type,
    duelId,
    dbDuelId,
    message: messages[type],
    stakeAmount,
    rewardAmount,
    isRead: false,
    createdAt: new Date().toISOString(),
    slug,
    title,
  };

  const existing = getLocalNotifications();
  // Deduplicate: don't add if same type + duelId already exists
  if (existing.some((n) => n.type === type && n.duelId === duelId)) return;

  saveLocalNotifications([notification, ...existing]);
  notifyListeners();
}

export function markLocalNotificationRead(id: string): void {
  const notifications = getLocalNotifications();
  const updated = notifications.map((n) => n.id === id ? { ...n, isRead: true } : n);
  saveLocalNotifications(updated);
  notifyListeners();
}

export function markAllLocalNotificationsRead(): void {
  const notifications = getLocalNotifications();
  const updated = notifications.map((n) => ({ ...n, isRead: true }));
  saveLocalNotifications(updated);
  notifyListeners();
}

export function getLocalUnreadCount(): number {
  return getLocalNotifications().filter((n) => !n.isRead).length;
}

/**
 * Backfill local notifications with full slugs + titles from the server slug map.
 * Fixes notifications that were created with truncated on-chain slugs.
 */
export async function backfillLocalNotificationSlugs(): Promise<void> {
  try {
    const notifications = getLocalNotifications();
    if (notifications.length === 0) return;

    const { getDuelSlugMap } = await import('@/lib/pointsTracker');
    const slugMap = await getDuelSlugMap();
    if (!slugMap || Object.keys(slugMap).length === 0) return;

    let changed = false;
    const updated = notifications.map((n) => {
      const lookupId = n.dbDuelId ?? n.duelId;
      const entry = slugMap[lookupId];
      if (!entry) return n;
      const needsSlug = !n.slug || (entry.slug.length > n.slug.length);
      const needsTitle = !n.title && entry.title;
      if (!needsSlug && !needsTitle) return n;
      changed = true;
      return {
        ...n,
        slug: needsSlug ? entry.slug : n.slug,
        title: needsTitle ? entry.title : n.title,
      };
    });

    if (changed) {
      saveLocalNotifications(updated);
      notifyListeners();
    }
  } catch { /* non-critical */ }
}

export function clearLocalNotifications(): void {
  try {
    localStorage.removeItem(storageKey());
  } catch { /* ignore */ }
  notifyListeners();
}
