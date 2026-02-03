'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem } from '@/lib/motion';
import type { DashboardCloak } from '@/lib/core/DashboardService';
import { MembershipType } from '@/lib/core/RegistryService';
import { useAztecStore } from '@/store/aztecStore';

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
 * Get privacy level badge color
 */
function getPrivacyBadgeClass(level: string): string {
  switch (level) {
    case 'maximum':
      return 'bg-accent-muted text-accent';
    case 'balanced':
      return 'bg-status-warning/10 text-status-warning';
    case 'transparent':
      return 'bg-background-tertiary text-foreground-muted';
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
        {cloaks.map((cloak) => (
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
              <div>
                <h3 className="font-semibold text-foreground">{getDisplayName(cloak)}</h3>
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
            <div className="flex items-center gap-4 mb-3">
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

            {/* Footer */}
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${getPrivacyBadgeClass(
                  cloak.privacyLevel
                )}`}
              >
                {cloak.privacyLevel}
              </span>
              {cloak.isActive ? (
                <span className="px-2 py-0.5 text-xs bg-status-success/10 text-status-success rounded-full">
                  Active
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs bg-status-error/10 text-status-error rounded-full">
                  Inactive
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
