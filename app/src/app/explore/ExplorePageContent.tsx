'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { EnhancedCloakCard } from '@/components/cloak/EnhancedCloakCard';
import { TEMPLATE_METADATA, CATEGORY_INFO } from '@/lib/constants/templates';
import type { TemplateCategory, PrivacyLevel } from '@/lib/constants/templates';
import { useAztecStore } from '@/store/aztecStore';
import { CloakLogo } from '@/components/ui/CloakLogo';

const ConnectButton = dynamic(
  () => import('@/components/wallet/ConnectButton').then((mod) => mod.ConnectButton),
  { ssr: false, loading: () => <div className="w-32 h-10 bg-background-tertiary animate-shimmer rounded-md" /> }
);

// Mock data for public Cloaks - in production this would come from an indexer
const MOCK_PUBLIC_CLOAKS = [
  {
    address: '0x1234567890abcdef1234567890abcdef12345678',
    name: 'DeFi Builders Guild',
    memberCount: 127,
    proposalCount: 23,
    templateId: 8,
    privacyLevel: 'balanced' as PrivacyLevel,
    lastActivityAt: Date.now() - 3600000,
  },
  {
    address: '0xabcdef1234567890abcdef1234567890abcdef12',
    name: 'Open Science Collective',
    memberCount: 45,
    proposalCount: 12,
    templateId: 10,
    privacyLevel: 'balanced' as PrivacyLevel,
    lastActivityAt: Date.now() - 86400000,
  },
  {
    address: '0x9876543210fedcba9876543210fedcba98765432',
    name: 'Protocol Governance',
    memberCount: 892,
    proposalCount: 156,
    templateId: 6,
    privacyLevel: 'transparent' as PrivacyLevel,
    lastActivityAt: Date.now() - 1800000,
  },
  {
    address: '0xfedcba9876543210fedcba9876543210fedcba98',
    name: 'NFT Collectors Cloak',
    memberCount: 234,
    proposalCount: 67,
    templateId: 7,
    privacyLevel: 'balanced' as PrivacyLevel,
    lastActivityAt: Date.now() - 7200000,
  },
  {
    address: '0x1111222233334444555566667777888899990000',
    name: 'Ecosystem Grants',
    memberCount: 15,
    proposalCount: 89,
    templateId: 5,
    privacyLevel: 'balanced' as PrivacyLevel,
    lastActivityAt: Date.now() - 43200000,
  },
  {
    address: '0xaaabbbcccdddeeefffaaabbbcccdddeeefffaaab',
    name: 'Community Treasury',
    memberCount: 312,
    proposalCount: 45,
    templateId: 2,
    privacyLevel: 'balanced' as PrivacyLevel,
    lastActivityAt: Date.now() - 14400000,
  },
];

export function ExplorePageContent() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'members' | 'activity' | 'proposals'>('members');

  // Real Cloaks from the store that are publicly searchable
  const storeCloaks = useAztecStore((s: any) =>
    s.cloakList.filter((d: any) => d.isPubliclySearchable)
  );

  const filteredCloaks = useMemo(() => {
    // Merge mock cloaks with real searchable cloaks from store
    const realCloaks = storeCloaks.map((d: any) => ({
      address: d.address,
      name: d.name,
      slug: d.slug,
      memberCount: d.memberCount,
      proposalCount: d.proposalCount,
      templateId: d.templateId ?? 1,
      privacyLevel: (d.privacyLevel ?? 'balanced') as PrivacyLevel,
      lastActivityAt: d.lastActivityAt ?? Date.now(),
    }));
    let cloaks = [...MOCK_PUBLIC_CLOAKS.map(d => ({ ...d, slug: undefined as string | undefined })), ...realCloaks];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      cloaks = cloaks.filter((cloak) => cloak.name.toLowerCase().includes(query));
    }

    // Category filter
    if (categoryFilter !== 'all') {
      cloaks = cloaks.filter((cloak) => {
        const template = TEMPLATE_METADATA[cloak.templateId as keyof typeof TEMPLATE_METADATA];
        return template?.category === categoryFilter;
      });
    }

    // Sort
    cloaks.sort((a, b) => {
      switch (sortBy) {
        case 'members':
          return b.memberCount - a.memberCount;
        case 'activity':
          return (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
        case 'proposals':
          return (b.proposalCount || 0) - (a.proposalCount || 0);
        default:
          return 0;
      }
    });

    return cloaks;
  }, [searchQuery, categoryFilter, sortBy]);

  const handleCloakClick = (cloak: { address: string; slug?: string }) => {
    router.push(`/cloak/${cloak.slug || cloak.address}`);
  };

  return (
    <div className="min-h-screen bg-background-secondary">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <CloakLogo />
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-foreground-secondary hover:text-foreground text-sm font-medium"
              >
                Dashboard
              </Link>
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Explore Cloaks</h1>
            <p className="text-foreground-secondary mt-2">
              Discover public Cloaks and join communities that match your interests.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-card border border-border rounded-md p-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Search Cloaks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 pl-10 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
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

              {/* Category Filter */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-4 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              >
                <option value="all">All Categories</option>
                {Object.entries(CATEGORY_INFO).map(([key, info]) => (
                  <option key={key} value={key}>
                    {info.label}
                  </option>
                ))}
              </select>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'members' | 'activity' | 'proposals')}
                className="px-4 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              >
                <option value="members">Most Members</option>
                <option value="activity">Most Active</option>
                <option value="proposals">Most Proposals</option>
              </select>
            </div>
          </div>

          {/* Results */}
          {filteredCloaks.length === 0 ? (
            <div className="bg-card border border-border border-dashed rounded-md p-12 text-center">
              <svg
                className="w-12 h-12 text-foreground-muted mx-auto mb-4"
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
              <h3 className="text-lg font-medium text-foreground mb-2">No Cloaks found</h3>
              <p className="text-foreground-muted mb-4">
                Try adjusting your search or filters to find more Cloaks.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('all');
                }}
                className="text-accent hover:text-accent font-medium"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground-muted mb-4">
                {filteredCloaks.length} Cloak{filteredCloaks.length !== 1 ? 's' : ''} found
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredCloaks.map((cloak) => (
                  <EnhancedCloakCard
                    key={cloak.address}
                    address={cloak.address}
                    name={cloak.name}
                    memberCount={cloak.memberCount}
                    proposalCount={cloak.proposalCount}
                    templateId={cloak.templateId}
                    privacyLevel={cloak.privacyLevel}
                    lastActivityAt={cloak.lastActivityAt}
                    onClick={() => handleCloakClick(cloak)}
                  />
                ))}
              </div>
            </>
          )}

          {/* CTA */}
          <div className="mt-12 bg-accent-muted border border-accent rounded-md p-8 text-center">
            <h3 className="text-xl font-semibold text-foreground mb-2">
              Don't see what you're looking for?
            </h3>
            <p className="text-foreground-secondary mb-4">
              Create your own Cloak with customizable templates and privacy settings.
            </p>
            <Link
              href="/create"
              className="inline-flex items-center px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
            >
              Create a Cloak
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
