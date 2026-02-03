'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { scaleIn, badgePop } from '@/lib/motion';
import { useNotificationStore, NOTIFICATION_ICONS } from '@/store/notificationStore';
import * as Icons from 'lucide-react';

interface NotificationBellProps {
  onViewAll?: () => void;
}

export function NotificationBell({ onViewAll }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationStore();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const recentNotifications = notifications.slice(0, 5);

  const getIcon = (iconName: string) => {
    const Icon = Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
    return Icon ? <Icon className="w-5 h-5" /> : <Icons.Bell className="w-5 h-5" />;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-md transition-colors"
        aria-label="Notifications"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Badge */}
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full"
              variants={badgePop}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <motion.div
          className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-md shadow-lg z-50"
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="text-sm text-accent hover:text-accent-hover"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-96 overflow-y-auto">
            {recentNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-foreground-muted">
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
                <p>No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (!notification.read) markAsRead(notification.id);
                      if (notification.link) {
                        window.location.href = notification.link;
                      }
                    }}
                    className={`px-4 py-3 hover:bg-card-hover cursor-pointer ${
                      !notification.read ? 'bg-accent-muted' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      <span className="text-xl flex-shrink-0">
                        {getIcon(NOTIFICATION_ICONS[notification.type])}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {notification.title}
                          </p>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-accent rounded-full flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-sm text-foreground-secondary line-clamp-2">{notification.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {notification.cloakName && (
                            <span className="text-xs text-accent">{notification.cloakName}</span>
                          )}
                          <span className="text-xs text-foreground-muted">
                            {formatTimeAgo(notification.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && onViewAll && (
            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={() => {
                  onViewAll();
                  setIsOpen(false);
                }}
                className="w-full text-center text-sm text-accent hover:text-accent-hover font-medium"
              >
                View all notifications
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
