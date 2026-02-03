'use client';

import React from 'react';

export type ActivityType =
  | 'proposal'
  | 'vote'
  | 'member'
  | 'treasury'
  | 'execution'
  | 'milestone'
  | 'settings';

export interface Activity {
  id: string;
  type: ActivityType;
  action: string; // e.g., "created", "approved", "rejected", "joined", "transferred"
  title: string;
  description?: string;
  actor?: {
    address: string;
    isAnonymous?: boolean;
  };
  timestamp: Date;
  metadata?: {
    proposalId?: string;
    amount?: string;
    tokenSymbol?: string;
    targetAddress?: string;
    txHash?: string;
    link?: string;
  };
}

interface ActivityItemProps {
  activity: Activity;
  compact?: boolean;
}

const TYPE_CONFIG: Record<ActivityType, { icon: React.ReactNode; color: string; bgColor: string }> = {
  proposal: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    color: 'text-status-info',
    bgColor: 'bg-status-info/10',
  },
  vote: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
  },
  member: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    color: 'text-template-purple',
    bgColor: 'bg-template-purple/10',
  },
  treasury: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'text-status-warning',
    bgColor: 'bg-status-warning/10',
  },
  execution: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    color: 'text-accent',
    bgColor: 'bg-accent-muted',
  },
  milestone: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    color: 'text-pink-600',
    bgColor: 'bg-pink-100',
  },
  settings: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    color: 'text-foreground-secondary',
    bgColor: 'bg-background-tertiary',
  },
};

export function ActivityItem({ activity, compact = false }: ActivityItemProps) {
  const config = TYPE_CONFIG[activity.type];

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatActor = () => {
    if (!activity.actor) return null;
    if (activity.actor.isAnonymous) return 'Anonymous';
    const addr = activity.actor.address;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const actor = formatActor();

  if (compact) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className={`w-8 h-8 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
          <span className={config.color}>{config.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">
            {actor && <span className="font-medium">{actor}</span>} {activity.action} {activity.title}
          </p>
        </div>
        <span className="text-xs text-foreground-muted flex-shrink-0">{formatTime(activity.timestamp)}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Icon */}
      <div className={`w-10 h-10 rounded-full ${config.bgColor} flex items-center justify-center flex-shrink-0`}>
        <span className={config.color}>{config.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-foreground">
              {actor && (
                <span className="font-medium">{actor}</span>
              )}{' '}
              <span className="text-foreground-secondary">{activity.action}</span>{' '}
              <span className="font-medium">{activity.title}</span>
            </p>
            {activity.description && (
              <p className="text-sm text-foreground-muted mt-1">{activity.description}</p>
            )}
          </div>
          <span className="text-sm text-foreground-muted flex-shrink-0">{formatTime(activity.timestamp)}</span>
        </div>

        {/* Metadata */}
        {activity.metadata && (
          <div className="mt-2 flex flex-wrap gap-2">
            {activity.metadata.amount && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-status-success/10 text-status-success rounded">
                {activity.metadata.amount} {activity.metadata.tokenSymbol || 'tokens'}
              </span>
            )}
            {activity.metadata.txHash && (
              <a
                href={`https://explorer.aztec.network/tx/${activity.metadata.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-2 py-0.5 text-xs text-accent hover:text-accent-hover"
              >
                View tx →
              </a>
            )}
            {activity.metadata.link && (
              <a
                href={activity.metadata.link}
                className="inline-flex items-center px-2 py-0.5 text-xs text-accent hover:text-accent-hover"
              >
                View details →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
