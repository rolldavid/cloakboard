'use client';

import React from 'react';
import { motion } from 'framer-motion';

import type { TemplateMetadata } from '@/lib/constants/templates';
import { PRIVACY_LEVEL_INFO } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';

interface TemplateCardProps {
  template: TemplateMetadata;
  onSelect: (templateId: number) => void;
  onPreview: (template: TemplateMetadata) => void;
  isSelected?: boolean;
}

/**
 * Card component for displaying a single template option
 */
export function TemplateCard({ template, onSelect, onPreview, isSelected = false }: TemplateCardProps) {
  const privacyInfo = PRIVACY_LEVEL_INFO[template.defaultPrivacy];
  const isComingSoon = template.status === 'coming_soon';

  const colorClasses: Record<string, string> = {
    indigo: 'border-accent bg-accent-muted',
    emerald: 'border-accent bg-accent-muted',
    rose: 'border-accent bg-accent-muted',
    blue: 'border-accent bg-accent-muted',
    purple: 'border-accent bg-accent-muted',
    slate: 'border-accent bg-accent-muted',
    pink: 'border-accent bg-accent-muted',
    amber: 'border-accent bg-accent-muted',
    violet: 'border-accent bg-accent-muted',
    cyan: 'border-accent bg-accent-muted',
  };

  const iconBgClasses: Record<string, string> = {
    indigo: 'bg-template-indigo/10',
    emerald: 'bg-template-emerald/10',
    rose: 'bg-template-rose/10',
    blue: 'bg-template-blue/10',
    purple: 'bg-template-purple/10',
    slate: 'bg-template-slate/10',
    pink: 'bg-template-pink/10',
    amber: 'bg-template-amber/10',
    violet: 'bg-template-violet/10',
    cyan: 'bg-template-cyan/10',
  };

  const privacyColorClasses: Record<string, string> = {
    rose: 'bg-template-rose/10 text-privacy-maximum',
    indigo: 'bg-template-indigo/10 text-privacy-balanced',
    emerald: 'bg-template-emerald/10 text-privacy-transparent',
  };

  return (
    <motion.div
      whileHover={isComingSoon ? undefined : { y: -2, transition: { duration: 0.2 } }}
      className={`relative bg-card border-2 rounded-md p-5 transition-all ${
        isComingSoon
          ? 'border-border opacity-75 cursor-default'
          : isSelected
            ? `cursor-pointer hover:shadow-md ${colorClasses[template.color] || 'border-accent bg-accent-muted'}`
            : 'cursor-pointer hover:shadow-md border-border hover:border-border-hover'
      }`}
      onClick={() => !isComingSoon && onSelect(template.id)}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-md flex items-center justify-center text-xl ${
              iconBgClasses[template.color] || 'bg-background-tertiary'
            }`}
          >
            <TemplateIcon name={template.icon} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{template.name}</h3>
              {isComingSoon && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-foreground-muted/10 text-foreground-muted">
                  Coming Soon
                </span>
              )}
            </div>
            <span
              className={`inline-block px-2 py-0.5 text-xs rounded-full ${
                privacyColorClasses[privacyInfo.color] || 'bg-background-tertiary text-foreground-secondary'
              }`}
            >
              {privacyInfo.label}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-foreground-secondary mb-4">{template.description}</p>

      {/* Features */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {template.features.slice(0, 3).map((feature) => (
          <span key={feature} className="px-2 py-0.5 bg-background-tertiary text-foreground-secondary text-xs rounded">
            {feature}
          </span>
        ))}
        {template.features.length > 3 && (
          <span className="px-2 py-0.5 bg-background-tertiary text-foreground-muted text-xs rounded">
            +{template.features.length - 3} more
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {isComingSoon ? (
          <button
            disabled
            className="flex-1 px-3 py-2 text-sm font-medium rounded-md bg-background-tertiary text-foreground-muted cursor-not-allowed"
          >
            Coming Soon
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(template.id);
            }}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              isSelected
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-background-tertiary text-foreground-secondary hover:bg-background-tertiary'
            }`}
          >
            {isSelected ? 'Selected' : 'Select'}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview(template);
          }}
          className="px-3 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-md transition-colors"
        >
          Details
        </button>
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-3 right-3">
          <div className="w-6 h-6 bg-accent rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
    </motion.div>
  );
}
