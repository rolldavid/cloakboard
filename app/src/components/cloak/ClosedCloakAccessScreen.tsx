'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';

interface ClosedCloakAccessScreenProps {
  cloakName?: string;
  onConnectWallet?: () => void;
  isMember?: boolean;
  isCheckingMembership?: boolean;
}

/**
 * Screen shown for closed cloaks when user doesn't have access.
 * - Not authenticated: Prompt to connect wallet
 * - Authenticated but not a member: Show access denied
 */
export function ClosedCloakAccessScreen({
  cloakName,
  onConnectWallet,
  isMember,
  isCheckingMembership,
}: ClosedCloakAccessScreenProps) {
  const { isAuthenticated, address } = useAuth();

  // Checking membership status
  if (isCheckingMembership) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="w-16 h-16 border-4 border-template-emerald border-t-transparent rounded-full animate-spin mb-6" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Verifying Membership</h2>
        <p className="text-foreground-secondary text-center max-w-md">
          Checking if you have access to this cloak...
        </p>
      </div>
    );
  }

  // Not authenticated - prompt to connect
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="w-20 h-20 rounded-full bg-template-emerald/10 flex items-center justify-center mb-6">
          <svg
            className="w-10 h-10 text-template-emerald"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>

        <h2 className="text-2xl font-semibold text-foreground mb-2">Private Cloak</h2>
        {cloakName && <p className="text-lg text-foreground-secondary mb-4">{cloakName}</p>}

        <p className="text-foreground-secondary text-center max-w-md mb-8">
          This cloak is only visible to members. Connect your wallet to verify your membership.
        </p>

        <button
          onClick={onConnectWallet}
          className="px-6 py-3 bg-template-emerald text-white font-medium rounded-lg hover:bg-template-emerald/90 transition-colors"
        >
          Connect Wallet
        </button>

        <p className="text-sm text-foreground-muted mt-6 text-center max-w-sm">
          To access this cloak, you need to hold the required tokens in your Aztec or Ethereum wallet.
        </p>
      </div>
    );
  }

  // Authenticated but not a member
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="w-20 h-20 rounded-full bg-status-error/10 flex items-center justify-center mb-6">
        <svg
          className="w-10 h-10 text-status-error"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-semibold text-foreground mb-2">Access Denied</h2>
      {cloakName && <p className="text-lg text-foreground-secondary mb-4">{cloakName}</p>}

      <p className="text-foreground-secondary text-center max-w-md mb-4">
        You don't have access to this cloak. Only token holders can view its content.
      </p>

      {address && (
        <div className="p-4 bg-background-secondary rounded-lg mb-6 max-w-md w-full">
          <p className="text-sm text-foreground-muted mb-1">Connected Account</p>
          <p className="font-mono text-sm text-foreground truncate">{address}</p>
        </div>
      )}

      <div className="space-y-3 text-center">
        <p className="text-sm text-foreground-secondary">
          To gain access, you need to:
        </p>
        <ul className="text-sm text-foreground-muted space-y-2">
          <li className="flex items-center gap-2 justify-center">
            <span className="w-5 h-5 rounded-full bg-template-emerald/20 text-template-emerald text-xs flex items-center justify-center">1</span>
            Hold the required tokens in your Ethereum or Aztec wallet
          </li>
          <li className="flex items-center gap-2 justify-center">
            <span className="w-5 h-5 rounded-full bg-template-emerald/20 text-template-emerald text-xs flex items-center justify-center">2</span>
            Try connecting with a different account
          </li>
        </ul>
      </div>

      <div className="flex gap-4 mt-8">
        <button
          onClick={onConnectWallet}
          className="px-6 py-3 bg-background-secondary text-foreground font-medium rounded-lg hover:bg-background-tertiary transition-colors border border-border"
        >
          Try Different Account
        </button>
        <Link
          href="/explore"
          className="px-6 py-3 bg-template-emerald text-white font-medium rounded-lg hover:bg-template-emerald/90 transition-colors"
        >
          Explore Cloaks
        </Link>
      </div>
    </div>
  );
}
