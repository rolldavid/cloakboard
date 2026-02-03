'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { PrivacyBadge } from '@/components/privacy';
import { getTemplateMetadata } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import type { TemplateId } from '@/lib/templates/TemplateFactory';
import type { PrivacyLevel } from '@/lib/constants/templates';

interface EnhancedCloakCardProps {
  address: string;
  name: string;
  memberCount: number;
  proposalCount?: number;
  templateId?: number;
  privacyLevel?: PrivacyLevel;
  pendingActions?: number;
  lastActivityAt?: number;
  onClick?: () => void;
}

/**
 * Enhanced Cloak card with template icon, privacy badge, and notifications
 */
export function EnhancedCloakCard({
  address,
  name,
  memberCount,
  proposalCount = 0,
  templateId,
  privacyLevel = 'balanced',
  pendingActions = 0,
  lastActivityAt,
  onClick,
}: EnhancedCloakCardProps) {
  const template = templateId
    ? getTemplateMetadata(templateId as TemplateId)
    : null;

  const colorClasses: Record<string, string> = {
    indigo: 'bg-accent-muted',
    emerald: 'bg-emerald-100',
    rose: 'bg-rose-100',
    blue: 'bg-status-info/10',
    purple: 'bg-template-purple/10',
    slate: 'bg-slate-100',
    pink: 'bg-pink-100',
    amber: 'bg-status-warning/10',
    violet: 'bg-violet-100',
    cyan: 'bg-cyan-100',
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  return (
    <motion.div
      onClick={onClick}
      className="relative bg-card border border-border rounded-md p-5 hover:border-accent hover:shadow-md transition-all cursor-pointer"
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      {/* Notification Badge */}
      {pendingActions > 0 && (
        <div className="absolute -top-2 -right-2 w-6 h-6 bg-status-error text-white text-xs font-bold rounded-full flex items-center justify-center">
          {pendingActions > 9 ? '9+' : pendingActions}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {template ? (
            <div
              className={`w-10 h-10 rounded-md flex items-center justify-center text-xl ${
                colorClasses[template.color] || 'bg-background-tertiary'
              }`}
            >
              <TemplateIcon name={template.icon} />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-md flex items-center justify-center bg-background-tertiary">
              <svg
                className="w-5 h-5 text-foreground-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
          )}
          <div>
            <h3 className="font-semibold text-foreground">{name}</h3>
          </div>
        </div>
        <PrivacyBadge level={privacyLevel} size="sm" showLabel={false} />
      </div>

      {/* Template Badge */}
      {template && (
        <div className="mb-3">
          <span className="text-xs text-foreground-muted">{template.name}</span>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-6">
        <div>
          <span className="text-xl font-bold text-accent">{memberCount}</span>
          <span className="text-xs text-foreground-muted ml-1">members</span>
        </div>
        <div>
          <span className="text-xl font-bold text-accent">{proposalCount}</span>
          <span className="text-xs text-foreground-muted ml-1">proposals</span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
        {lastActivityAt ? (
          <span className="text-xs text-foreground-muted">
            Active {formatTimeAgo(lastActivityAt)}
          </span>
        ) : (
          <span className="text-xs text-foreground-muted">No recent activity</span>
        )}

        {pendingActions > 0 && (
          <span className="text-xs text-status-error font-medium">
            {pendingActions} pending {pendingActions === 1 ? 'action' : 'actions'}
          </span>
        )}
      </div>
    </motion.div>
  );
}
