import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '@/lib/api/duelClient';
import type { AppNotification } from '@/lib/api/duelClient';
import { useAppStore } from '@/store/index';
import { getAuthToken } from '@/lib/api/authToken';

const POLL_INTERVAL_MS = 45_000;
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 5;

export function useNotifications() {
  const { isAuthenticated } = useAppStore();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!isAuthenticated || !getAuthToken()) return false;
    try {
      setIsLoading(true);
      const data = await fetchNotifications(20);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const markRead = useCallback(async (id: number) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* silent */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setNotifications([]);
      setUnreadCount(0);
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

    intervalRef.current = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [isAuthenticated, refetch]);

  return { notifications, unreadCount, markRead, markAllRead, refetch, isLoading };
}
