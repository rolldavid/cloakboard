/**
 * Local (client-side) notifications for market voting rewards.
 *
 * Market win/loss notifications are purely client-side because the server
 * never learns vote direction (privacy). These are stored in localStorage
 * and merged with server notifications in useNotifications.
 */

const STORAGE_KEY = 'duelcloak_local_notifications';
const MAX_LOCAL_NOTIFICATIONS = 50;

export interface LocalNotification {
  id: string; // "local-{timestamp}-{random}"
  type: 'market_win' | 'market_loss' | 'market_refund';
  duelId: number;
  message: string;
  stakeAmount: number;
  rewardAmount: number; // 100 for win, 0 for loss, stakeAmount for refund
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
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* localStorage full */ }
}

export function addLocalNotification(
  type: LocalNotification['type'],
  duelId: number,
  stakeAmount: number,
  rewardAmount: number,
  slug?: string,
  title?: string,
): void {
  const messages: Record<LocalNotification['type'], string> = {
    market_win: `You won! +${rewardAmount} pts earned`,
    market_loss: `Your ${stakeAmount} pt stake was burned`,
    market_refund: `Duel refunded — ${rewardAmount} pts returned`,
  };

  const notification: LocalNotification = {
    id: generateId(),
    type,
    duelId,
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

export function clearLocalNotifications(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  notifyListeners();
}
