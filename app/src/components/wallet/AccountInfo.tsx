'use client';

/**
 * Account Info Component
 *
 * Displays information about the connected wallet account,
 * including address, deployment status, and actions.
 */

import React, { useState } from 'react';
import { useWallet, useWalletStatus, useAccounts } from '@/lib/hooks/useWallet';

export function AccountInfo() {
  const { state, deployAccount, exportMnemonic, lock } = useWallet();
  const { isConnected, isDeployed, isLoading, error } = useWalletStatus();
  const accounts = useAccounts();

  const [showMnemonic, setShowMnemonic] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  if (!isConnected || !state.address) {
    return (
      <div className="p-4 bg-background-secondary rounded-md text-center text-foreground-muted">
        No account connected
      </div>
    );
  }

  const mnemonic = showMnemonic ? exportMnemonic() : null;
  const currentAccount = accounts.find(a => a.address === state.address);

  const handleDeploy = async () => {
    setIsDeploying(true);
    setDeployError(null);

    try {
      await deployAccount();
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Failed to deploy account');
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="p-4 bg-card border border-border rounded-md space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Account Details</h3>
        <button
          onClick={lock}
          className="text-sm text-foreground-muted hover:text-foreground-secondary"
        >
          Lock
        </button>
      </div>

      <div className="space-y-3">
        {/* Address */}
        <div>
          <label className="text-xs text-foreground-muted uppercase tracking-wide">
            Address
          </label>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm break-all flex-1">{state.address}</p>
            <button
              onClick={() => navigator.clipboard.writeText(state.address!)}
              className="text-accent hover:text-accent text-sm shrink-0"
            >
              Copy
            </button>
          </div>
        </div>

        {/* Account Name */}
        {currentAccount && (
          <div>
            <label className="text-xs text-foreground-muted uppercase tracking-wide">
              Account Name
            </label>
            <p className="text-sm">{currentAccount.alias}</p>
          </div>
        )}

        {/* Deployment Status */}
        <div>
          <label className="text-xs text-foreground-muted uppercase tracking-wide">
            Status
          </label>
          <p className="text-sm">
            {isDeployed ? (
              <span className="inline-flex items-center gap-1.5 text-status-success">
                <span className="w-2 h-2 bg-status-success rounded-full" />
                Deployed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-status-warning">
                <span className="w-2 h-2 bg-status-warning rounded-full" />
                Not Deployed
              </span>
            )}
          </p>
        </div>

        {/* Network */}
        <div>
          <label className="text-xs text-foreground-muted uppercase tracking-wide">
            Network
          </label>
          <p className="text-sm capitalize">{state.networkId}</p>
        </div>
      </div>

      {/* Recovery Phrase Section */}
      <div className="pt-4 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-foreground-muted uppercase tracking-wide">
            Recovery Phrase
          </label>
          <button
            onClick={() => setShowMnemonic(!showMnemonic)}
            className="text-accent hover:text-accent text-sm"
          >
            {showMnemonic ? 'Hide' : 'Show'}
          </button>
        </div>

        {showMnemonic && mnemonic && (
          <div className="p-3 bg-status-error/10 border border-status-error rounded-md">
            <p className="text-xs text-status-error mb-2">
              Never share this phrase with anyone!
            </p>
            <p className="font-mono text-xs break-all">{mnemonic}</p>
          </div>
        )}

        {showMnemonic && !mnemonic && (
          <p className="text-sm text-foreground-muted">
            Unable to retrieve recovery phrase. The wallet may need to be unlocked again.
          </p>
        )}
      </div>

      {/* Deploy Button */}
      {!isDeployed && (
        <div className="pt-4 border-t border-border">
          {deployError && (
            <div className="mb-3 p-2 bg-status-error/10 border border-status-error text-status-error rounded-md text-sm">
              {deployError}
            </div>
          )}

          <button
            onClick={handleDeploy}
            disabled={isDeploying || isLoading}
            className="w-full px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50"
          >
            {isDeploying ? 'Deploying...' : 'Deploy Account'}
          </button>

          <p className="mt-2 text-xs text-foreground-muted text-center">
            Deploying your account creates it on-chain, enabling you to participate in Cloaks.
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-status-error/10 border border-status-error text-status-error rounded-md text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
