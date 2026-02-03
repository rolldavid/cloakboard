'use client';

import React from 'react';

type VerificationStatus = 'verified' | 'pending' | 'unverified' | 'failed';

interface DomainVerificationBadgeProps {
  domain?: string;
  status: VerificationStatus;
  verifiedAt?: Date;
  onVerify?: () => void;
  compact?: boolean;
}

const STATUS_CONFIG: Record<VerificationStatus, { label: string; icon: React.ReactNode; bgColor: string; textColor: string }> = {
  verified: {
    label: 'Verified',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    bgColor: 'bg-status-success/10',
    textColor: 'text-status-success',
  },
  pending: {
    label: 'Pending Verification',
    icon: (
      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    ),
    bgColor: 'bg-status-warning/10',
    textColor: 'text-status-warning',
  },
  unverified: {
    label: 'Not Verified',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    ),
    bgColor: 'bg-background-tertiary',
    textColor: 'text-foreground-secondary',
  },
  failed: {
    label: 'Verification Failed',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
    bgColor: 'bg-status-error/10',
    textColor: 'text-status-error',
  },
};

export function DomainVerificationBadge({
  domain,
  status,
  verifiedAt,
  onVerify,
  compact = false,
}: DomainVerificationBadgeProps) {
  const config = STATUS_CONFIG[status];

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${config.bgColor} ${config.textColor}`}
        title={domain ? `${config.label}: ${domain}` : config.label}
      >
        {config.icon}
        {status === 'verified' && domain && <span>{domain}</span>}
      </span>
    );
  }

  return (
    <div className={`p-4 rounded-md ${config.bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={config.textColor}>{config.icon}</span>
          <div>
            <p className={`font-medium ${config.textColor}`}>{config.label}</p>
            {domain && (
              <p className="text-sm text-foreground-secondary">{domain}</p>
            )}
            {verifiedAt && status === 'verified' && (
              <p className="text-xs text-foreground-muted">
                Verified on {verifiedAt.toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        {status === 'unverified' && onVerify && (
          <button
            onClick={onVerify}
            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          >
            Verify Domain
          </button>
        )}

        {status === 'failed' && onVerify && (
          <button
            onClick={onVerify}
            className="px-3 py-1.5 text-sm bg-status-error hover:bg-status-error/90 text-white rounded-md transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
