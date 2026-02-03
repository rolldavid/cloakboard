import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NotificationType =
  | 'proposal_created'
  | 'proposal_passed'
  | 'proposal_rejected'
  | 'vote_reminder'
  | 'member_joined'
  | 'member_left'
  | 'funds_received'
  | 'funds_sent'
  | 'milestone_completed'
  | 'review_requested'
  | 'job_assigned'
  | 'dispute_opened'
  | 'event_reminder'
  | 'perk_available'
  | 'general';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  cloakAddress?: string;
  cloakName?: string;
  link?: string;
  createdAt: Date;
  read: boolean;
  metadata?: Record<string, unknown>;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  lastChecked: Date | null;

  // Actions
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  removeNotification: (notificationId: string) => void;
  clearAll: () => void;
  clearForCloak: (cloakAddress: string) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,
      lastChecked: null,

      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          createdAt: new Date(),
          read: false,
        };

        set((state) => ({
          notifications: [newNotification, ...state.notifications].slice(0, 100), // Keep last 100
          unreadCount: state.unreadCount + 1,
        }));
      },

      markAsRead: (notificationId) => {
        set((state) => {
          const notification = state.notifications.find((n) => n.id === notificationId);
          if (!notification || notification.read) return state;

          return {
            notifications: state.notifications.map((n) =>
              n.id === notificationId ? { ...n, read: true } : n
            ),
            unreadCount: Math.max(0, state.unreadCount - 1),
          };
        });
      },

      markAllAsRead: () => {
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
          lastChecked: new Date(),
        }));
      },

      removeNotification: (notificationId) => {
        set((state) => {
          const notification = state.notifications.find((n) => n.id === notificationId);
          return {
            notifications: state.notifications.filter((n) => n.id !== notificationId),
            unreadCount: notification && !notification.read
              ? Math.max(0, state.unreadCount - 1)
              : state.unreadCount,
          };
        });
      },

      clearAll: () => {
        set({
          notifications: [],
          unreadCount: 0,
        });
      },

      clearForCloak: (cloakAddress) => {
        set((state) => {
          const removedUnread = state.notifications.filter(
            (n) => n.cloakAddress === cloakAddress && !n.read
          ).length;
          return {
            notifications: state.notifications.filter((n) => n.cloakAddress !== cloakAddress),
            unreadCount: Math.max(0, state.unreadCount - removedUnread),
          };
        });
      },
    }),
    {
      name: 'private-cloak-notifications',
      // Custom serialization to handle Date objects
      serialize: (state) => JSON.stringify({
        ...state,
        state: {
          ...state.state,
          notifications: state.state.notifications.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
          })),
          lastChecked: state.state.lastChecked?.toISOString() || null,
        },
      }),
      deserialize: (str) => {
        const parsed = JSON.parse(str);
        return {
          ...parsed,
          state: {
            ...parsed.state,
            notifications: parsed.state.notifications.map((n: Notification & { createdAt: string }) => ({
              ...n,
              createdAt: new Date(n.createdAt),
            })),
            lastChecked: parsed.state.lastChecked ? new Date(parsed.state.lastChecked) : null,
          },
        };
      },
    }
  )
);

// Helper to get notifications for a specific Cloak
export const useCloakNotifications = (cloakAddress: string) => {
  const notifications = useNotificationStore((state) =>
    state.notifications.filter((n) => n.cloakAddress === cloakAddress)
  );
  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications, unreadCount };
};

// Type icons for notifications (lucide-react icon component names)
export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  proposal_created: 'FileText',
  proposal_passed: 'CheckCircle',
  proposal_rejected: 'XCircle',
  vote_reminder: 'Vote',
  member_joined: 'UserPlus',
  member_left: 'UserMinus',
  funds_received: 'DollarSign',
  funds_sent: 'ArrowUpRight',
  milestone_completed: 'Target',
  review_requested: 'Eye',
  job_assigned: 'Briefcase',
  dispute_opened: 'Scale',
  event_reminder: 'Calendar',
  perk_available: 'Gift',
  general: 'Bell',
};
