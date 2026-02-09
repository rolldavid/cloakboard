'use client';

import React from 'react';
import { useCloakContext } from './CloakContext';
import { getTemplateMetadata } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import { useAztecStore } from '@/store/aztecStore';

export function CloakHeader() {
  const { name, templateId, address, isLoading } = useCloakContext();

  // Starred state
  const starredAddresses = useAztecStore((s) => s.starredAddresses);
  const addStarredAddress = useAztecStore((s) => s.addStarredAddress);
  const removeStarredAddress = useAztecStore((s) => s.removeStarredAddress);
  const isStarred = address ? starredAddresses.includes(address) : false;

  const handleToggleStar = () => {
    if (!address) return;
    if (isStarred) {
      removeStarredAddress(address);
    } else {
      addStarredAddress(address);
    }
  };

  const template = getTemplateMetadata(templateId);

  if (isLoading) {
    return (
      <div className="bg-card border-b border-border px-6 py-4 animate-shimmer">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-background-tertiary rounded-lg" />
          <div>
            <div className="h-6 w-48 bg-background-tertiary rounded-md mb-2" />
            <div className="h-4 w-32 bg-background-tertiary rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  const colorClasses: Record<string, { bg: string; text: string }> = {
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
    slate: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400' },
  };

  return (
    <div className="bg-card border-b border-border">
      <div className="px-6 py-4">
        <div className="flex items-center">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                colorClasses[template.color]?.bg || 'bg-background-tertiary'
              }`}
            >
              <TemplateIcon name={template.icon} size="lg" className={colorClasses[template.color]?.text || 'text-foreground-muted'} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-foreground">{name}</h1>
                <button
                  onClick={handleToggleStar}
                  className="p-1.5 rounded-md hover:bg-background-tertiary transition-colors"
                  title={isStarred ? 'Unstar this cloak' : 'Star this cloak'}
                >
                  {isStarred ? (
                    <svg className="w-5 h-5 text-amber-400 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
