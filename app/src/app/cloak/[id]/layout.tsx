'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { LoadingOwl } from '@/components/ui/LoadingOwl';

// Dynamically import the shell to avoid SSR issues
const CloakShell = dynamic(
  () => import('@/components/cloak/shell').then((m) => m.CloakShell),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-background-secondary flex items-center justify-center">
        <LoadingOwl />
      </div>
    ),
  }
);

interface LayoutProps {
  children: React.ReactNode;
  params: { id: string };
}

export default function CloakLayout({ children, params }: LayoutProps) {
  const { id } = params;

  return <CloakShell address={id}>{children}</CloakShell>;
}
