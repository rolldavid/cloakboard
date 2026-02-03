'use client';

import React from 'react';
import type { TemplateMetadata } from '@/lib/constants/templates';
import { PRIVACY_LEVEL_INFO, CATEGORY_INFO } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';

interface TemplatePreviewProps {
  template: TemplateMetadata;
  onClose: () => void;
  onSelect: (templateId: number) => void;
}

/**
 * Modal for showing detailed template information
 */
export function TemplatePreview({ template, onClose, onSelect }: TemplatePreviewProps) {
  const privacyInfo = PRIVACY_LEVEL_INFO[template.defaultPrivacy];
  const categoryInfo = CATEGORY_INFO[template.category];

  const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
    indigo: { bg: 'bg-template-indigo/10', text: 'text-accent', border: 'border-border' },
    emerald: { bg: 'bg-template-emerald/10', text: 'text-accent', border: 'border-border' },
    rose: { bg: 'bg-template-rose/10', text: 'text-accent', border: 'border-border' },
    blue: { bg: 'bg-template-blue/10', text: 'text-accent', border: 'border-border' },
    purple: { bg: 'bg-template-purple/10', text: 'text-accent', border: 'border-border' },
    slate: { bg: 'bg-template-slate/10', text: 'text-accent', border: 'border-border' },
    pink: { bg: 'bg-template-pink/10', text: 'text-accent', border: 'border-border' },
    amber: { bg: 'bg-template-amber/10', text: 'text-accent', border: 'border-border' },
    violet: { bg: 'bg-template-violet/10', text: 'text-accent', border: 'border-border' },
    cyan: { bg: 'bg-template-cyan/10', text: 'text-accent', border: 'border-border' },
  };

  const colors = colorClasses[template.color] || colorClasses.indigo;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-card rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-6 border-b ${colors.border}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-md flex items-center justify-center text-3xl ${colors.bg}`}>
                <TemplateIcon name={template.icon} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">{template.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${colors.bg} ${colors.text}`}>
                    {categoryInfo.label}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      template.defaultPrivacy === 'maximum'
                        ? 'bg-template-rose/10 text-privacy-maximum'
                        : template.defaultPrivacy === 'transparent'
                          ? 'bg-template-emerald/10 text-privacy-transparent'
                          : 'bg-template-indigo/10 text-privacy-balanced'
                    }`}
                  >
                    {privacyInfo.label}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-foreground-muted hover:text-foreground-secondary hover:bg-card-hover rounded-md transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">About</h3>
            <p className="text-foreground-secondary">{template.longDescription}</p>
          </div>

          {/* Features */}
          <div>
            <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-3">Features</h3>
            <div className="grid grid-cols-2 gap-3">
              {template.features.map((feature) => (
                <div key={feature} className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${colors.bg}`}>
                    <svg className={`w-3 h-3 ${colors.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-sm text-foreground-secondary">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Use Cases */}
          <div>
            <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-3">Best For</h3>
            <div className="flex flex-wrap gap-2">
              {template.useCases.map((useCase) => (
                <span key={useCase} className="px-3 py-1.5 bg-background-tertiary text-foreground-secondary text-sm rounded-md">
                  {useCase}
                </span>
              ))}
            </div>
          </div>

          {/* Privacy Info */}
          <div className={`p-4 rounded-md ${colors.bg} border ${colors.border}`}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-card flex items-center justify-center flex-shrink-0">
                {template.defaultPrivacy === 'maximum' ? (
                  <svg className="w-5 h-5 text-privacy-maximum" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                ) : template.defaultPrivacy === 'transparent' ? (
                  <svg className="w-5 h-5 text-privacy-transparent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-privacy-balanced" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                    />
                  </svg>
                )}
              </div>
              <div>
                <p className={`font-medium ${colors.text}`}>{privacyInfo.label}</p>
                <p className="text-sm text-foreground-secondary mt-0.5">{privacyInfo.description}</p>
                <p className="text-xs text-foreground-muted mt-2">
                  Vote choices are always private. Privacy settings can be customized during setup.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-foreground-secondary hover:bg-card-hover rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSelect(template.id);
              onClose();
            }}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
          >
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
}
