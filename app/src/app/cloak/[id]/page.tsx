'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useAztecStore } from '@/store/aztecStore';
import { useAuth } from '@/lib/hooks/useAuth';

// Dynamically import to avoid SSR issues
const CloakDashboard = dynamic(
  () => import('@/components/cloak/CloakDashboard').then((m) => m.CloakDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="animate-shimmer space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-background-tertiary rounded-md" />
          ))}
        </div>
        <div className="h-64 bg-background-tertiary rounded-md" />
      </div>
    ),
  }
);

export default function CloakPage() {
  const params = useParams();
  const router = useRouter();
  const cloakId = params.id as string;
  const { isAuthenticated } = useAuth();

  // Try slug-based lookup first, then fall back to address
  const cloakBySlug = useAztecStore((s: any) => s.cloakList.find((d: any) => d.slug === cloakId));
  const cloakByAddress = useAztecStore((s: any) => s.cloakList.find((d: any) => d.address === cloakId));
  const cloak = cloakBySlug || cloakByAddress;

  // If the cloak is not publicly viewable and the user is not authenticated,
  // redirect to home
  if (cloak && !cloak.isPubliclyViewable && !isAuthenticated) {
    if (typeof window !== 'undefined') {
      router.replace('/');
    }
    return null;
  }

  const cloakAddress = cloak?.address || cloakId;
  const cloakMode = cloak?.cloakMode;

  return <CloakDashboard cloakAddress={cloakAddress} cloakMode={cloakMode} />;
}
