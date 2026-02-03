'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { ActivityItem, type Activity } from './ActivityItem';

interface ActivityFeedProps {
  activities: Activity[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  showFilters?: boolean;
}

export function ActivityFeed({
  activities,
  isLoading = false,
  onLoadMore,
  hasMore = false,
  showFilters = true,
}: ActivityFeedProps) {
  const [typeFilter, setTypeFilter] = useState<Activity['type'] | 'all'>('all');

  const filteredActivities = useMemo(() => {
    if (typeFilter === 'all') return activities;
    return activities.filter((a) => a.type === typeFilter);
  }, [activities, typeFilter]);

  // Group activities by date
  const groupedActivities = useMemo(() => {
    const groups: { [key: string]: Activity[] } = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    filteredActivities.forEach((activity) => {
      const dateStr = activity.timestamp.toDateString();
      let groupKey: string;

      if (dateStr === today) {
        groupKey = 'Today';
      } else if (dateStr === yesterday) {
        groupKey = 'Yesterday';
      } else {
        groupKey = activity.timestamp.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(activity);
    });

    return groups;
  }, [filteredActivities]);

  if (isLoading && activities.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 animate-shimmer">
            <div className="w-10 h-10 bg-background-tertiary rounded-full flex-shrink-0" />
            <div className="flex-1">
              <div className="h-4 bg-background-tertiary rounded w-3/4 mb-2" />
              <div className="h-3 bg-background-tertiary rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      {showFilters && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(['all', 'proposal', 'vote', 'member', 'treasury', 'execution'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
                typeFilter === filter
                  ? 'bg-accent text-white'
                  : 'bg-background-tertiary text-foreground-secondary hover:bg-background-tertiary'
              }`}
            >
              {filter === 'all' ? 'All Activity' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Activity List */}
      {filteredActivities.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="font-medium">No activity yet</p>
          <p className="text-sm mt-1">Activity will appear here as members interact with the Cloak</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedActivities).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-foreground-muted mb-4">{date}</h3>
              <motion.div
                className="space-y-4"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {items.map((activity) => (
                  <motion.div key={activity.id} variants={staggerItem}>
                    <ActivityItem activity={activity} />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && onLoadMore && (
        <div className="text-center">
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="px-6 py-2 text-sm text-accent hover:text-accent-hover hover:bg-accent-muted rounded-md transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Loading...' : 'Load more activity'}
          </button>
        </div>
      )}
    </div>
  );
}
