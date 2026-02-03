'use client';

import React from 'react';
import type { PrivacyLevel } from '@/lib/constants/templates';

interface PrivacyBadgeProps {
  level: PrivacyLevel;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  showLabel?: boolean;
}

const LEVEL_CONFIG: Record<PrivacyLevel, { label: string; shortLabel: string; bgColor: string; textColor: string }> = {
  maximum: {
    label: 'Maximum Privacy',
    shortLabel: 'Private',
    bgColor: 'bg-template-rose/10',
    textColor: 'text-privacy-maximum',
  },
  balanced: {
    label: 'Balanced',
    shortLabel: 'Balanced',
    bgColor: 'bg-template-indigo/10',
    textColor: 'text-privacy-balanced',
  },
  transparent: {
    label: 'Transparent',
    shortLabel: 'Public',
    bgColor: 'bg-template-emerald/10',
    textColor: 'text-privacy-transparent',
  },
};

/**
 * Compact badge showing privacy level
 */
export function PrivacyBadge({
  level,
  size = 'sm',
  showIcon = true,
  showLabel = true,
}: PrivacyBadgeProps) {
  const config = LEVEL_CONFIG[level];

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-sm',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const renderIcon = () => {
    if (!showIcon) return null;

    const className = iconSizes[size];

    if (level === 'maximum') {
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      );
    }

    if (level === 'transparent') {
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      );
    }

    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    );
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${config.bgColor} ${config.textColor} ${sizeClasses[size]}`}
      title={config.label}
    >
      {renderIcon()}
      {showLabel && <span>{size === 'sm' ? config.shortLabel : config.label}</span>}
    </span>
  );
}
