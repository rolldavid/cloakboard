'use client';

import React from 'react';
import type { PrivacyLevel } from '@/lib/constants/templates';

interface PrivacySliderProps {
  value: PrivacyLevel;
  onChange: (value: PrivacyLevel) => void;
  disabled?: boolean;
}

const LEVELS: PrivacyLevel[] = ['maximum', 'balanced', 'transparent'];

const LEVEL_INFO: Record<PrivacyLevel, { label: string; description: string; features: string[] }> = {
  maximum: {
    label: 'Maximum Privacy',
    description: 'All data hidden. Best for sensitive operations.',
    features: ['Hidden member list', 'Anonymous voting', 'Private proposals', 'No activity feed'],
  },
  balanced: {
    label: 'Balanced',
    description: 'Members visible to each other. Votes always private.',
    features: ['Members-only list', 'Private votes', 'Public proposals', 'Aggregated activity'],
  },
  transparent: {
    label: 'Transparent',
    description: 'Maximum visibility for accountability. Votes still private.',
    features: ['Public members', 'Private votes', 'Public treasury', 'Full activity feed'],
  },
};

/**
 * 3-level privacy slider component
 */
export function PrivacySlider({ value, onChange, disabled = false }: PrivacySliderProps) {
  const currentIndex = LEVELS.indexOf(value);
  const info = LEVEL_INFO[value];

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value);
    onChange(LEVELS[index]);
  };

  return (
    <div className={`space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Level Labels */}
      <div className="flex justify-between text-sm">
        {LEVELS.map((level, index) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            className={`text-center transition-colors ${
              index === currentIndex ? 'text-accent font-medium' : 'text-foreground-muted hover:text-foreground-secondary'
            }`}
          >
            {LEVEL_INFO[level].label}
          </button>
        ))}
      </div>

      {/* Slider Track */}
      <div className="relative">
        <div className="h-2 bg-background-tertiary rounded-full">
          <div
            className="h-2 rounded-full transition-all bg-gradient-to-r from-rose-500 via-indigo-500 to-emerald-500"
            style={{ width: `${((currentIndex + 1) / LEVELS.length) * 100}%` }}
          />
        </div>
        <input
          type="range"
          min="0"
          max={LEVELS.length - 1}
          value={currentIndex}
          onChange={handleSliderChange}
          className="absolute inset-0 w-full h-2 opacity-0 cursor-pointer"
          disabled={disabled}
        />
        {/* Slider Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-card border-2 border-accent rounded-full shadow-md transition-all"
          style={{ left: `${(currentIndex / (LEVELS.length - 1)) * 100}%` }}
        />
      </div>

      {/* Current Level Info */}
      <div
        className={`p-4 rounded-md border transition-colors ${
          value === 'maximum'
            ? 'bg-accent-muted border-border'
            : value === 'transparent'
              ? 'bg-accent-muted border-border'
              : 'bg-accent-muted border-border'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
              value === 'maximum'
                ? 'bg-template-rose/10'
                : value === 'transparent'
                  ? 'bg-template-emerald/10'
                  : 'bg-template-indigo/10'
            }`}
          >
            {value === 'maximum' ? (
              <svg
                className="w-5 h-5 text-privacy-maximum"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            ) : value === 'transparent' ? (
              <svg
                className="w-5 h-5 text-privacy-transparent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
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
              <svg
                className="w-5 h-5 text-privacy-balanced"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <p
              className={`font-medium ${
                value === 'maximum'
                  ? 'text-privacy-maximum'
                  : value === 'transparent'
                    ? 'text-privacy-transparent'
                    : 'text-privacy-balanced'
              }`}
            >
              {info.label}
            </p>
            <p className="text-sm text-foreground-secondary mt-0.5">{info.description}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {info.features.map((feature) => (
                <span key={feature} className="px-2 py-0.5 bg-card/60 text-foreground-secondary text-xs rounded">
                  {feature}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Important Note */}
      <p className="text-xs text-foreground-muted">
        Privacy settings can only become more public over time, never more private. Vote choices are
        always kept private.
      </p>
    </div>
  );
}
