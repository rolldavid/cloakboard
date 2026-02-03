'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { MemberList } from '@/components/cloak/MemberList';
import { useAztecStore } from '@/store/aztecStore';

export default function MembersPage() {
  const params = useParams();
  const cloakId = params.id as string;
  const cloakList = useAztecStore((state: any) => state.cloakList);
  const cloak = cloakList.find((d: any) => d.address === cloakId);

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

          <MemberList
            cloakAddress={cloakId}
            memberCount={cloak?.memberCount}
            cloakMode={cloak?.cloakMode}
          />
        </div>
      </main>
    </div>
  );
}
