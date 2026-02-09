'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem, contentFade } from '@/lib/motion';
import { useDashboard } from '@/lib/hooks/useDashboard';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { CloakSection } from './CloakSection';
import { EnhancedCloakCard } from '@/components/cloak/EnhancedCloakCard';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import { TEMPLATE_METADATA, TEMPLATE_DISPLAY_ORDER, CATEGORY_INFO, getTemplateSlug } from '@/lib/constants/templates';
import type { DashboardCloak } from '@/lib/core/DashboardService';
import { useAztecStore } from '@/store/aztecStore';

const templateColorMap: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-400' },
};

/**
 * Section tabs for filtering
 */
const SECTION_TABS = [
  { id: 'all', label: 'All Cloaks' },
  { id: 'starred', label: 'Starred' },
  { id: 'created', label: 'Created' },
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
] as const;

/**
 * Main Dashboard component
 */
export function Dashboard() {
  const router = useRouter();
  const {
    isLoading,
    error,
    groupedCloaks,
    stats,
    selectedSection,
    filters,
    setFilters,
    setSection,
    getFilteredCloaks,
    refresh,
    isStarred,
    toggleStar,
  } = useDashboard();

  const storeCloaks = useAztecStore((s: any) => s.cloakList);
  const [isCreating, setIsCreating] = useState(false);

  // Get wallet context to refresh cloak connections
  const { refreshCloakConnections, isClientReady } = useWalletContext();

  // Refresh cloak connections from PXE when dashboard mounts
  useEffect(() => {
    if (isClientReady && refreshCloakConnections) {
      refreshCloakConnections().catch((err) => {
        console.warn('[Dashboard] Failed to refresh cloak connections:', err);
      });
    }
  }, [isClientReady, refreshCloakConnections]);

  const handleCloakClick = (cloak: DashboardCloak) => {
    // Prefer slug-based routing
    const storeEntry = storeCloaks.find((d: any) => d.address === cloak.address);
    router.push(`/cloak/${storeEntry?.slug || cloak.address}`);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...filters, searchQuery: e.target.value });
  };

  const filteredCloaks = useMemo(() => getFilteredCloaks(), [getFilteredCloaks]);

  if (isLoading) {
    return (
      <motion.div
        className="animate-shimmer space-y-6"
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {/* Cloak list skeleton */}
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-40 bg-background-tertiary rounded-md" />
          ))}
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <div className="bg-status-error/10 border border-status-error rounded-md p-6 text-center">
        <p className="text-status-error font-medium mb-2">Failed to load dashboard</p>
        <p className="text-status-error text-sm mb-4">{error}</p>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-status-error hover:bg-status-error text-card rounded-md transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-background-tertiary p-1 rounded-md">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSection(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  selectedSection === tab.id
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-foreground-secondary hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Actions */}
          <div className="flex gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <input
                type="text"
                placeholder="Search Cloaks..."
                value={filters.searchQuery || ''}
                onChange={handleSearchChange}
                className="w-full sm:w-64 px-4 py-2 pl-10 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>

            <motion.button
              onClick={() => { setIsCreating(true); router.push('/create'); }}
              disabled={isCreating}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-card rounded-md font-medium transition-colors whitespace-nowrap disabled:opacity-70 inline-flex items-center gap-2"
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              {isCreating && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Create Cloak
            </motion.button>
          </div>
        </div>

      </div>

      {/* Cloak List */}
      {filteredCloaks.length === 0 ? (
        <div className="bg-background-secondary border border-border border-dashed rounded-md p-12 text-center">
          <div className="w-16 h-16 bg-background-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-foreground-muted"
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
          <h3 className="text-lg font-medium text-foreground mb-2">No Cloaks found</h3>
          <p className="text-foreground-muted mb-6">
            {filters.searchQuery
              ? 'No Cloaks match your search.'
              : selectedSection === 'starred'
                ? 'Star cloaks from Discover to track them here.'
                : selectedSection === 'all'
                  ? "You're not a member of any Cloaks yet."
                  : `You don't have any Cloaks in this category.`}
          </p>
          <Link
            href="/create"
            className="inline-flex items-center px-4 py-2 bg-accent hover:bg-accent-hover text-card rounded-md font-medium transition-colors"
          >
            Create Your First Cloak
          </Link>
        </div>
      ) : selectedSection === 'all' && !filters.searchQuery ? (
        <>
          {groupedCloaks.created.length > 0 && (
            <CloakSection
              title="Created by You"
              description="Cloaks you've created and manage"
              cloaks={groupedCloaks.created}
              emptyMessage="You haven't created any Cloaks yet"
              onCloakClick={handleCloakClick}
            />
          )}
          {groupedCloaks.admin.length > 0 && (
            <CloakSection
              title="Admin Access"
              description="Cloaks where you have admin privileges"
              cloaks={groupedCloaks.admin}
              emptyMessage="You're not an admin of any Cloaks"
              onCloakClick={handleCloakClick}
            />
          )}
          {groupedCloaks.member.length > 0 && (
            <CloakSection
              title="Member"
              description="Cloaks you're a member of"
              cloaks={groupedCloaks.member}
              emptyMessage="You're not a member of any Cloaks"
              onCloakClick={handleCloakClick}
            />
          )}
        </>
      ) : (
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {filteredCloaks.map((cloak) => {
            const storeEntry = storeCloaks.find((d: any) => d.address === cloak.address);
            return (
              <motion.div key={cloak.address} variants={staggerItem}>
                <EnhancedCloakCard
                  key={cloak.address}
                  address={cloak.address}
                  name={storeEntry?.name || cloak.templateName}
                  memberCount={cloak.memberCount}
                  proposalCount={cloak.recentActivity?.proposalCount}
                  templateId={storeEntry?.templateId || (cloak as any).templateId}
                  pendingActions={(cloak as any).pendingActions}
                  onClick={() => handleCloakClick(cloak)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Templates */}
      <div className="pt-8">
        <h2 className="text-xl font-bold text-foreground mb-2">Templates</h2>
        <p className="text-foreground-secondary text-sm mb-6">
          Choose a template to get started. Each one is purpose-built for a different kind of private organization.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEMPLATE_DISPLAY_ORDER.map((id) => {
            const template = TEMPLATE_METADATA[id];
            const isComingSoon = template.status === 'coming_soon';
            return (
              <Link
                key={template.id}
                href={isComingSoon ? '#' : `/create/${getTemplateSlug(template.id)}`}
                className={`relative bg-card border border-border rounded-lg p-5 ${isComingSoon ? 'opacity-60 cursor-default' : 'hover:border-border-hover transition-colors'}`}
                onClick={isComingSoon ? (e) => e.preventDefault() : undefined}
              >
                {isComingSoon && (
                  <span className="absolute top-3 right-3 text-xs font-medium bg-background-tertiary text-foreground-muted px-2 py-0.5 rounded-full">
                    Coming Soon
                  </span>
                )}
                <div className={`w-9 h-9 rounded-md flex items-center justify-center mb-3 ${templateColorMap[template.color]?.bg ?? ''}`}>
                  <TemplateIcon name={template.icon} size="lg" className={templateColorMap[template.color]?.text ?? ''} />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{template.name}</h3>
                <p className="text-xs text-foreground-secondary mb-2">{template.description}</p>
                <span className="text-xs font-medium text-foreground-muted bg-background-tertiary px-2 py-0.5 rounded">
                  {CATEGORY_INFO[template.category].label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
