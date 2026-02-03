'use client';

import React, { useState } from 'react';

interface Delegate {
  address: string;
  votingPower: bigint;
  delegatedFromCount: number;
  delegationPercentage: number;
}

interface DelegationManagerProps {
  currentDelegation?: string; // Address you're currently delegating to
  selfDelegated: boolean;
  yourVotingPower: bigint;
  yourRawBalance: bigint;
  decimals: number;
  tokenSymbol: string;
  topDelegates: Delegate[];
  onDelegate: (toAddress: string) => Promise<void>;
  onSelfDelegate: () => Promise<void>;
  isLoading?: boolean;
}

export function DelegationManager({
  currentDelegation,
  selfDelegated,
  yourVotingPower,
  yourRawBalance,
  decimals,
  tokenSymbol,
  topDelegates,
  onDelegate,
  onSelfDelegate,
  isLoading = false,
}: DelegationManagerProps) {
  const [customAddress, setCustomAddress] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const formatAmount = (amount: bigint) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    return integerPart.toLocaleString();
  };

  const handleCustomDelegate = async () => {
    if (!customAddress) return;
    await onDelegate(customAddress);
    setCustomAddress('');
    setShowCustomInput(false);
  };

  return (
    <div className="space-y-6">
      {/* Your Delegation Status */}
      <div className="bg-card border border-border rounded-md p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Your Delegation</h3>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 bg-background-secondary rounded-md">
            <p className="text-sm text-foreground-muted">Your Balance</p>
            <p className="text-xl font-bold text-foreground">
              {formatAmount(yourRawBalance)} {tokenSymbol}
            </p>
          </div>
          <div className="p-4 bg-accent-muted rounded-md">
            <p className="text-sm text-accent">Voting Power</p>
            <p className="text-xl font-bold text-accent">
              {formatAmount(yourVotingPower)} {tokenSymbol}
            </p>
          </div>
        </div>

        {/* Current Delegation Status */}
        <div className="mb-6">
          <p className="text-sm text-foreground-muted mb-2">Currently Delegating To</p>
          {selfDelegated ? (
            <div className="flex items-center gap-2 p-3 bg-status-success/10 border border-status-success rounded-md">
              <svg className="w-5 h-5 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium text-status-success">Self-delegated (You vote directly)</span>
            </div>
          ) : currentDelegation ? (
            <div className="flex items-center justify-between p-3 bg-background-secondary border border-border rounded-md">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-template-purple flex items-center justify-center text-white text-sm font-medium">
                  {currentDelegation.slice(2, 4).toUpperCase()}
                </div>
                <span className="font-medium text-foreground">
                  {currentDelegation.slice(0, 6)}...{currentDelegation.slice(-4)}
                </span>
              </div>
              <button
                onClick={onSelfDelegate}
                disabled={isLoading}
                className="text-sm text-accent hover:text-accent"
              >
                Reclaim votes
              </button>
            </div>
          ) : (
            <div className="p-3 bg-status-warning/10 border border-status-warning rounded-md">
              <span className="text-status-warning">Not delegated - your votes are inactive</span>
            </div>
          )}
        </div>

        {/* Delegation Actions */}
        {!selfDelegated && (
          <div className="space-y-3">
            <button
              onClick={onSelfDelegate}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : 'Delegate to Self'}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-foreground-muted">or delegate to someone else</span>
              </div>
            </div>

            {showCustomInput ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  placeholder="Enter delegate address (0x...)"
                  className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                />
                <button
                  onClick={handleCustomDelegate}
                  disabled={isLoading || !customAddress}
                  className="px-4 py-2 bg-foreground hover:bg-foreground text-white rounded-md transition-colors disabled:opacity-50"
                >
                  Delegate
                </button>
                <button
                  onClick={() => setShowCustomInput(false)}
                  className="px-3 py-2 text-foreground-muted hover:text-foreground-secondary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustomInput(true)}
                className="w-full px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary rounded-md transition-colors"
              >
                Enter Custom Address
              </button>
            )}
          </div>
        )}
      </div>

      {/* Top Delegates */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Top Delegates</h3>
        </div>

        {topDelegates.length === 0 ? (
          <div className="p-8 text-center text-foreground-muted">
            <p>No delegates found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {topDelegates.map((delegate, index) => (
              <div key={delegate.address} className="px-6 py-4 hover:bg-card-hover">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-sm font-medium text-foreground-muted">#{index + 1}</span>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-template-purple flex items-center justify-center text-white font-medium">
                      {delegate.address.slice(2, 4).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {delegate.address.slice(0, 6)}...{delegate.address.slice(-4)}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        {delegate.delegatedFromCount} delegators
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-medium text-foreground">
                        {formatAmount(delegate.votingPower)} {tokenSymbol}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        {delegate.delegationPercentage.toFixed(2)}% of total
                      </p>
                    </div>

                    {currentDelegation !== delegate.address && (
                      <button
                        onClick={() => onDelegate(delegate.address)}
                        disabled={isLoading}
                        className="px-3 py-1.5 text-sm border border-accent text-accent hover:bg-accent-muted rounded-md transition-colors disabled:opacity-50"
                      >
                        Delegate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
