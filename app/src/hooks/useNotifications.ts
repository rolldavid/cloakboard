import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api/duelClient';
import type { AppNotification } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';
import { getAuthToken } from '@/lib/api/authToken';
import {
  getLocalNotifications,
  getLocalUnreadCount,
  markLocalNotificationRead,
  markAllLocalNotificationsRead,
  onLocalNotificationsChanged,
  backfillLocalNotificationSlugs,
} from '@/lib/notifications/localNotifications';
import type { LocalNotification } from '@/lib/notifications/localNotifications';

const POLL_INTERVAL_MS = 45_000;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 5;

/** Convert a LocalNotification to AppNotification shape for unified rendering. */
function localToApp(n: LocalNotification): AppNotification {
  return {
    id: n.id as any, // string ID — handled specially in markRead
    type: n.type as any,
    duelId: n.duelId,
    duelSlug: n.slug || null,
    duelTitle: n.title || null,
    message: n.message,
    metadata: { stakeAmount: n.stakeAmount, rewardAmount: n.rewardAmount },
    isRead: n.isRead,
    createdAt: n.createdAt,
  };
}

export function useNotifications() {
  const { isAuthenticated } = useAppStore();
  const [serverNotifications, setServerNotifications] = useState<AppNotification[]>([]);
  const [serverUnreadCount, setServerUnreadCount] = useState(0);
  const [localVersion, setLocalVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for local notification changes
  useEffect(() => {
    return onLocalNotificationsChanged(() => setLocalVersion((v) => v + 1));
  }, []);

  const refetch = useCallback(async () => {
    if (!isAuthenticated || !getAuthToken()) return false;
    try {
      setIsLoading(true);
      const data = await fetchNotifications(20);
      setServerNotifications(data.notifications);
      setServerUnreadCount(data.unreadCount);
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Merge server + local notifications, sorted by createdAt desc
  const localNotifs = getLocalNotifications();
  const localAppNotifs = localNotifs.map(localToApp);
  const merged = [...localAppNotifs, ...serverNotifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const unreadCount = serverUnreadCount + getLocalUnreadCount();

  const markRead = useCallback(async (id: number | string) => {
    // Local notifications have string IDs starting with "local-"
    if (typeof id === 'string' && String(id).startsWith('local-')) {
      markLocalNotificationRead(id);
      return;
    }
    try {
      await markNotificationRead(id as number);
      setServerNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
      setServerUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* silent */ }
  }, []);

  const markAllRead = useCallback(async () => {
    markAllLocalNotificationsRead();
    try {
      await markAllNotificationsRead();
      setServerNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setServerUnreadCount(0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setServerNotifications([]);
      setServerUnreadCount(0);
      return;
    }

    // Retry quickly if auth token isn't ready yet (session restore in progress)
    let retries = 0;
    async function fetchWithRetry() {
      const ok = await refetch();
      if (!ok && retries < MAX_RETRIES) {
        retries++;
        retryRef.current = setTimeout(fetchWithRetry, RETRY_DELAY_MS);
      }
    }
    fetchWithRetry();

    // Backfill local notifications that have truncated/missing slugs from the slug map
    backfillLocalNotificationSlugs();

    intervalRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [isAuthenticated, refetch]);

  return { notifications: merged, unreadCount, markRead, markAllRead, refetch, isLoading };
}
