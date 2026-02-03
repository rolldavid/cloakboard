'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function TreasuryPage() {
  const params = useParams();
  const cloakId = params.id as string;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <CloakLogo />
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Link href={`/cloak/${cloakId}`} className="text-accent hover:text-accent text-sm">
              &larr; Back to Dashboard
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-8">Treasury</h1>

          <div className="bg-card border border-border rounded-md p-6">
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-background-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-foreground mb-2">Treasury Coming Soon</h2>
              <p className="text-foreground-muted max-w-md mx-auto">
                Treasury management features including deposits, withdrawals, and asset tracking
                will be available in a future update.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
