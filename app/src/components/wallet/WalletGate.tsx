'use client';

/**
 * Wallet Gate Component
 *
 * A wrapper component that shows different content based on wallet state.
 * Use this to protect pages or sections that require a connected wallet.
 */

import React, { ReactNode } from 'react';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import { useWalletStatus, useWalletState } from '@/lib/hooks/useWallet';

interface WalletGateProps {
  children: ReactNode;

  // Custom components for different states
  noWalletComponent?: ReactNode;
  lockedComponent?: ReactNode;
  loadingComponent?: ReactNode;

  // Callbacks
  onCreateWallet?: () => void;
  onImportWallet?: () => void;

  // Options
  requireDeployed?: boolean;
}

/**
 * Default component shown when no wallet exists
 */
function DefaultNoWallet({
  onCreateWallet,
  onImportWallet,
}: {
  onCreateWallet?: () => void;
  onImportWallet?: () => void;
}) {
  return (
    <div className="max-w-md mx-auto p-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-accent-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-accent"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Wallet Required
        </h2>
        <p className="text-foreground-secondary">
          Create or import a wallet to access this feature.
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={onCreateWallet}
          className="w-full px-4 py-3 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
        >
          Create New Wallet
        </button>
        <button
          onClick={onImportWallet}
          className="w-full px-4 py-3 border border-border-hover text-foreground-secondary rounded-md hover:bg-card-hover transition-colors"
        >
          Import Existing Wallet
        </button>
      </div>
    </div>
  );
}

/**
 * Default component shown when wallet is locked
 */
function DefaultLocked() {
  return (
    <div className="max-w-md mx-auto p-6 text-center">
      <h2 className="text-xl font-semibold text-foreground mb-2">Session Expired</h2>
      <p className="text-foreground-secondary mb-4">Please sign in again to continue.</p>
      <a href="/onboarding" className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent-hover transition-colors inline-block">
        Sign In
      </a>
    </div>
  );
}

/**
 * Default loading component
 */
function DefaultLoading() {
  return (
    <div className="flex items-center justify-center p-8">
      <LoadingOwl text="Loading wallet..." />
    </div>
  );
}

/**
 * Wallet Gate
 *
 * Shows children only when wallet is connected.
 * Otherwise shows appropriate UI for the current state.
 */
export function WalletGate({
  children,
  noWalletComponent,
  lockedComponent,
  loadingComponent,
  onCreateWallet,
  onImportWallet,
  requireDeployed = false,
}: WalletGateProps) {
  const { status, isConnected, isDeployed, isLocked, hasWallet, isLoading } = useWalletStatus();
  const state = useWalletState();

  // Show loading state
  if (isLoading) {
    return <>{loadingComponent || <DefaultLoading />}</>;
  }

  // No wallet exists
  if (!hasWallet) {
    return (
      <>
        {noWalletComponent || (
          <DefaultNoWallet
            onCreateWallet={onCreateWallet}
            onImportWallet={onImportWallet}
          />
        )}
      </>
    );
  }

  // Wallet is locked
  if (isLocked) {
    return (
      <>
        {lockedComponent || <DefaultLocked />}
      </>
    );
  }

  // Require deployed account
  if (requireDeployed && !isDeployed) {
    return (
      <div className="max-w-md mx-auto p-6 text-center">
        <div className="w-16 h-16 bg-status-warning/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-status-warning"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Account Not Deployed
        </h2>
        <p className="text-foreground-secondary mb-6">
          Your account needs to be deployed on-chain before you can use this feature.
        </p>
        <p className="text-sm text-foreground-muted">
          Address: {state.address?.slice(0, 10)}...{state.address?.slice(-8)}
        </p>
      </div>
    );
  }

  // Wallet is connected
  return <>{children}</>;
}

/**
 * Higher-order component version of WalletGate
 */
export function withWalletGate<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  gateProps?: Omit<WalletGateProps, 'children'>
) {
  return function WalletGatedComponent(props: P) {
    return (
      <WalletGate {...gateProps}>
        <WrappedComponent {...props} />
      </WalletGate>
    );
  };
}
