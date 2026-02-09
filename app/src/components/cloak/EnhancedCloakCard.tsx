'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { getTemplateMetadata } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import type { TemplateId } from '@/lib/templates/TemplateFactory';

interface EnhancedCloakCardProps {
  address: string;
  name: string;
  memberCount: number;
  proposalCount?: number;
  templateId?: number;
  pendingActions?: number;
  onClick?: () => void;
}

/**
 * Enhanced Cloak card with template icon
 */
export function EnhancedCloakCard({
  name,
  memberCount,
  proposalCount = 0,
  templateId,
  pendingActions = 0,
  onClick,
}: EnhancedCloakCardProps) {
  const template = templateId
    ? getTemplateMetadata(templateId as TemplateId)
    : null;

  const iconBgClasses: Record<string, string> = {
    indigo: 'bg-indigo-100',
    emerald: 'bg-emerald-100',
    rose: 'bg-rose-100',
    blue: 'bg-blue-100',
    purple: 'bg-purple-100',
    slate: 'bg-slate-100',
    pink: 'bg-pink-100',
    amber: 'bg-amber-100',
    violet: 'bg-violet-100',
    cyan: 'bg-cyan-100',
    orange: 'bg-orange-100',
    teal: 'bg-teal-100',
  };

  const iconTextClasses: Record<string, string> = {
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    rose: 'text-rose-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    slate: 'text-slate-600',
    pink: 'text-pink-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
    cyan: 'text-cyan-600',
    orange: 'text-orange-600',
    teal: 'text-teal-600',
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
      <div className="flex items-center gap-3 mb-3">
        {template ? (
          <div
            className={`w-10 h-10 rounded-md flex items-center justify-center ${
              iconBgClasses[template.color] || 'bg-slate-100'
            }`}
          >
            <TemplateIcon
              name={template.icon}
              className={iconTextClasses[template.color] || 'text-slate-600'}
            />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-md flex items-center justify-center bg-slate-100">
            <svg
              className="w-5 h-5 text-slate-600"
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
          {template && (
            <span className="text-xs text-foreground-muted">{template.name}</span>
          )}
        </div>
      </div>

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
    </motion.div>
  );
}
