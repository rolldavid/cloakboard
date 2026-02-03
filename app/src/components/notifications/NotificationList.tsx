'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion';
import {
  useNotificationStore,
  NOTIFICATION_ICONS,
  type Notification,
  type NotificationType,
} from '@/store/notificationStore';
import * as Icons from 'lucide-react';

interface NotificationListProps {
  cloakAddress?: string; // Optional: filter by Cloak
}

export function NotificationList({ cloakAddress }: NotificationListProps) {
  const { notifications, markAsRead, markAllAsRead, removeNotification, clearAll } =
    useNotificationStore();

  const [typeFilter, setTypeFilter] = useState<NotificationType | 'all'>('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    if (cloakAddress && n.cloakAddress !== cloakAddress) return false;
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (showUnreadOnly && n.read) return false;
    return true;
  });

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const groupNotificationsByDate = (notifications: Notification[]) => {
    const groups: { [key: string]: Notification[] } = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    notifications.forEach((n) => {
      const dateStr = n.createdAt.toDateString();
      let groupKey: string;

      if (dateStr === today) {
        groupKey = 'Today';
      } else if (dateStr === yesterday) {
        groupKey = 'Yesterday';
      } else {
        groupKey = n.createdAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(n);
    });

    return groups;
  };

  const groupedNotifications = groupNotificationsByDate(filteredNotifications);

  const getIcon = (iconName: string) => {
    const Icon = Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
    return Icon ? <Icon className="w-5 h-5" /> : <Icons.Bell className="w-5 h-5" />;
  };

  return (
    <div className="space-y-4">
      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-4">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as NotificationType | 'all')}
            className="px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          >
            <option value="all">All Types</option>
            <option value="proposal_created">Proposals</option>
            <option value="vote_reminder">Voting</option>
            <option value="member_joined">Members</option>
            <option value="funds_received">Treasury</option>
            <option value="milestone_completed">Milestones</option>
            <option value="event_reminder">Events</option>
          </select>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="w-4 h-4 text-accent border-border rounded focus:ring-ring"
            />
            <span className="text-sm text-foreground-secondary">Unread only</span>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => markAllAsRead()}
            className="px-3 py-2 text-sm text-accent hover:text-accent-hover hover:bg-accent-muted rounded-md transition-colors"
          >
            Mark all read
          </button>
          <button
            onClick={() => {
              if (confirm('Clear all notifications?')) clearAll();
            }}
            className="px-3 py-2 text-sm text-status-error hover:text-red-700 hover:bg-status-error/10 rounded-md transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Notification List */}
      {filteredNotifications.length === 0 ? (
        <div className="bg-card border border-border rounded-md p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-foreground-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
          <p className="text-foreground-secondary font-medium">No notifications</p>
          <p className="text-sm text-foreground-muted mt-1">
            {showUnreadOnly ? 'No unread notifications' : "You're all caught up!"}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedNotifications).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-foreground-muted mb-3">{date}</h3>
              <motion.div
                className="bg-card border border-border rounded-md overflow-hidden divide-y divide-border"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {items.map((notification) => (
                  <motion.div
                    key={notification.id}
                    variants={staggerItem}
                    className={`px-4 py-4 hover:bg-card-hover transition-colors ${
                      !notification.read ? 'bg-accent-muted' : ''
                    }`}
                  >
                    <div className="flex gap-4">
                      <span className="text-2xl flex-shrink-0">
                        {getIcon(NOTIFICATION_ICONS[notification.type])}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-foreground">{notification.title}</p>
                            <p className="text-sm text-foreground-secondary mt-1">{notification.message}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {!notification.read && (
                              <button
                                onClick={() => markAsRead(notification.id)}
                                className="p-1 text-foreground-muted hover:text-accent"
                                title="Mark as read"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => removeNotification(notification.id)}
                              className="p-1 text-foreground-muted hover:text-status-error"
                              title="Remove"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 mt-2">
                          {notification.cloakName && (
                            <span className="text-xs px-2 py-0.5 bg-accent-muted text-accent rounded">
                              {notification.cloakName}
                            </span>
                          )}
                          <span className="text-xs text-foreground-muted">
                            {formatTimeAgo(notification.createdAt)}
                          </span>
                          {notification.link && (
                            <a
                              href={notification.link}
                              className="text-xs text-accent hover:text-accent-hover"
                            >
                              View details →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
