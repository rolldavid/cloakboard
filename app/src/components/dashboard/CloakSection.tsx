'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion';
import type { DashboardCloak } from '@/lib/core/DashboardService';
import { MembershipType } from '@/lib/core/RegistryService';
import { useAztecStore } from '@/store/aztecStore';
import { getTemplateMetadata } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import type { TemplateId } from '@/lib/templates/TemplateFactory';

interface CloakSectionProps {
  title: string;
  description: string;
  cloaks: DashboardCloak[];
  emptyMessage: string;
  onCloakClick?: (cloak: DashboardCloak) => void;
}

/**
 * Get role badge color
 */
function getRoleBadgeClass(type: MembershipType): string {
  switch (type) {
    case MembershipType.Creator:
      return 'bg-accent-muted text-accent';
    case MembershipType.Admin:
      return 'bg-status-info/10 text-status-info';
    case MembershipType.Member:
      return 'bg-status-success/10 text-status-success';
    default:
      return 'bg-background-tertiary text-foreground-muted';
  }
}


/**
 * Format address for display
 */
function formatAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

/**
 * Section component for grouping Cloaks by role
 */
export function CloakSection({
  title,
  description,
  cloaks,
  emptyMessage,
  onCloakClick,
}: CloakSectionProps) {
  const storeCloaks = useAztecStore((s: any) => s.cloakList);

  const getDisplayName = (cloak: DashboardCloak) => {
    const storeEntry = storeCloaks.find((d: any) => d.address === cloak.address);
    return storeEntry?.name || cloak.templateName;
  };

  const getTemplateInfo = (cloak: DashboardCloak) => {
    const storeEntry = storeCloaks.find((d: any) => d.address === cloak.address);
    const templateId = storeEntry?.templateId || (cloak as any).templateId;
    if (!templateId) return null;
    return getTemplateMetadata(templateId as TemplateId);
  };

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

  if (cloaks.length === 0) {
    return (
      <div className="mb-8">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-foreground-muted">{description}</p>
        </div>
        <div className="bg-background-secondary border border-border border-dashed rounded-md p-8 text-center">
          <p className="text-foreground-muted">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          {title}
          <span className="ml-2 px-2 py-0.5 bg-background-tertiary text-foreground-secondary text-sm rounded-full">
            {cloaks.length}
          </span>
        </h2>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>

      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {cloaks.map((cloak) => {
          const template = getTemplateInfo(cloak);
          return (
            <motion.div
              key={cloak.address}
              variants={staggerItem}
              onClick={() => onCloakClick?.(cloak)}
              className="bg-card border border-border rounded-md p-5 hover:border-accent hover:shadow-md transition-all cursor-pointer"
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
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
                    <h3 className="font-semibold text-foreground">{getDisplayName(cloak)}</h3>
                    {template && (
                      <span className="text-xs text-foreground-muted">{template.name}</span>
                    )}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${getRoleBadgeClass(
                    cloak.membershipType
                  )}`}
                >
                  {MembershipType[cloak.membershipType]}
                </span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xl font-bold text-accent">{cloak.memberCount}</span>
                  <span className="text-xs text-foreground-muted ml-1">members</span>
                </div>
                {cloak.recentActivity && (
                  <div>
                    <span className="text-xl font-bold text-accent">
                      {cloak.recentActivity.proposalCount}
                    </span>
                    <span className="text-xs text-foreground-muted ml-1">proposals</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
