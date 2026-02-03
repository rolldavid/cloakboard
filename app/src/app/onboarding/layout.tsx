/**
 * Onboarding Layout
 *
 * Layout for onboarding pages with a simple, focused design.
 */

import React from 'react';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-background-secondary">
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}
