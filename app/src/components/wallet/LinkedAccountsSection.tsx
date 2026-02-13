'use client';

import React from 'react';
import type { AuthMethod } from '@/types/wallet';
import type { LinkedAuthMethod } from '@/types/wallet';

interface LinkedAccountsSectionProps {
  primaryMethod: AuthMethod | null;
  linkedAccounts: LinkedAuthMethod[];
  onLink: (method: AuthMethod) => void;
  onUnlink: (method: AuthMethod) => void;
}

const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  google: 'Google',
  passkey: 'Passkey',
  email: 'Email',
  ethereum: 'ETH Wallet',
  solana: 'Solana',
};

const ALL_METHODS: AuthMethod[] = ['google', 'passkey', 'email', 'ethereum', 'solana'];

export function LinkedAccountsSection({
  primaryMethod,
  linkedAccounts,
  onLink,
  onUnlink,
}: LinkedAccountsSectionProps) {
  const linkedSet = new Set(linkedAccounts.map(a => a.method));

  return (
    <div className="px-3 py-2">
      <p className="text-xs font-medium text-foreground-muted mb-2">Linked Accounts</p>
      <div className="space-y-1">
        {ALL_METHODS.map((method) => {
          const isPrimary = method === primaryMethod;
          const isLinked = isPrimary || linkedSet.has(method);

          return (
            <div
              key={method}
              className="flex items-center justify-between text-sm py-1"
            >
              <span className="text-foreground-secondary">
                {AUTH_METHOD_LABELS[method]}
                {isPrimary && (
                  <span className="text-xs text-foreground-muted ml-1">(Primary)</span>
                )}
              </span>

              {isLinked ? (
                <div className="flex items-center gap-1.5">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-status-success"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {!isPrimary && (
                    <button
                      onClick={() => onUnlink(method)}
                      className="text-xs text-foreground-muted hover:text-status-error transition-colors"
                    >
                      Unlink
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => onLink(method)}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  + Link
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
