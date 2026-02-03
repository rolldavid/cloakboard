'use client';

import React from 'react';

interface WizardStepProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Individual step wrapper for wizard steps
 */
export function WizardStep({ title, description, children }: WizardStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && <p className="text-foreground-muted mt-1">{description}</p>}
      </div>
      {children}
    </div>
  );
}
