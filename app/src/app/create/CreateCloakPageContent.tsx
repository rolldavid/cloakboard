'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { TemplateGrid } from '@/components/templates/selection';
import { TEMPLATE_METADATA, getTemplateMetadata, getTemplateSlug } from '@/lib/constants/templates';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { TemplateIcon } from '@/components/ui/TemplateIcon';

export function CreateCloakPageContent() {
  const router = useRouter();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);

  const handleTemplateSelect = (templateId: number) => {
    setSelectedTemplateId(templateId);
  };

  const handleContinue = () => {
    if (selectedTemplateId) {
      setIsNavigating(true);
      router.push(`/create/${getTemplateSlug(selectedTemplateId)}`);
    }
  };

  const selectedTemplate = selectedTemplateId ? getTemplateMetadata(selectedTemplateId as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10) : null;

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
      <main className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <Link href="/dashboard" className="text-accent hover:text-accent text-sm">
              &larr; Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold text-foreground mt-4">Create a Cloak</h1>
            <p className="text-foreground-secondary mt-2">
              Choose a template that fits your needs. Each template comes with privacy features and
              governance settings optimized for specific use cases.
            </p>
          </div>

          {/* Template Selection */}
          <TemplateGrid selectedTemplateId={selectedTemplateId} onSelect={handleTemplateSelect} />

          {/* Continue Button */}
          {selectedTemplate && (
            <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4">
              <div className="max-w-6xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md flex items-center justify-center bg-accent-muted">
                    <TemplateIcon name={selectedTemplate.icon} size="lg" className="text-accent" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {selectedTemplate.name} Template Selected
                    </p>
                    <p className="text-sm text-foreground-muted">{selectedTemplate.description}</p>
                  </div>
                </div>
                <motion.button
                  onClick={handleContinue}
                  disabled={isNavigating}
                  className="px-6 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-md font-medium transition-colors flex items-center gap-2"
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  {isNavigating && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {isNavigating ? 'Loading...' : 'Continue to Setup'}
                </motion.button>
              </div>
            </div>
          )}

          {/* Spacer for fixed bottom bar */}
          {selectedTemplate && <div className="h-24" />}
        </div>
      </main>
    </div>
  );
}
