'use client';

import React, { ReactNode } from 'react';
import Link from 'next/link';
import { CloakProvider, useCloakContext } from './CloakContext';
import { CloakHeader } from './CloakHeader';
import { CloakNav } from './CloakNav';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { ConnectButton } from '@/components/wallet/ConnectButton';

interface CloakShellProps {
  address: string;
  children: ReactNode;
}

function TabSkeleton() {
  return (
    <div className="p-6 max-w-3xl mx-auto animate-shimmer">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-4 w-32 bg-background-tertiary rounded-md" />
        </div>
        <div className="h-9 w-24 bg-background-tertiary rounded-md" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card border border-border rounded-md p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-background-tertiary rounded-full" />
              <div className="h-4 w-32 bg-background-tertiary rounded-md" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-background-tertiary rounded-md w-full" />
              <div className="h-4 bg-background-tertiary rounded-md w-3/4" />
            </div>
            <div className="flex gap-4 mt-4">
              <div className="h-4 w-12 bg-background-tertiary rounded-md" />
              <div className="h-4 w-12 bg-background-tertiary rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CloakShellContent({ children }: { children: ReactNode }) {
  const { error, isLoading, navigatingTo } = useCloakContext();

  if (error) {
    return (
      <div className="min-h-screen bg-background-secondary flex items-center justify-center">
        <div className="bg-card border border-status-error/20 rounded-md p-8 max-w-md text-center">
          <svg
            className="w-12 h-12 text-status-error mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-foreground mb-2">Failed to Load Cloak</h2>
          <p className="text-foreground-secondary mb-4">{error}</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
          >
            &larr; Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-secondary">
      {/* Global Header */}
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

      {/* Cloak Header */}
      <CloakHeader />

      {/* Cloak Navigation */}
      <CloakNav />

      {/* Content */}
      <main className="py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {navigatingTo ? <TabSkeleton /> : children}
        </div>
      </main>
    </div>
  );
}

/**
 * Layout wrapper for all Cloak pages
 */
export function CloakShell({ address, children }: CloakShellProps) {
  return (
    <CloakProvider address={address}>
      <CloakShellContent>{children}</CloakShellContent>
    </CloakProvider>
  );
}
