'use client';

import React from 'react';

interface VotingPowerDisplayProps {
  votingPower: bigint;
  totalSupply: bigint;
  delegatedToYou: bigint;
  yourBalance: bigint;
  decimals: number;
  tokenSymbol: string;
  proposalThreshold?: bigint;
  quorum?: bigint;
  compact?: boolean;
}

export function VotingPowerDisplay({
  votingPower,
  totalSupply,
  delegatedToYou,
  yourBalance,
  decimals,
  tokenSymbol,
  proposalThreshold,
  quorum,
  compact = false,
}: VotingPowerDisplayProps) {
  const formatAmount = (amount: bigint) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    return integerPart.toLocaleString();
  };

  const getPercentage = (amount: bigint) => {
    if (totalSupply === 0n) return 0;
    return Number((amount * 10000n) / totalSupply) / 100;
  };

  const canPropose = proposalThreshold ? votingPower >= proposalThreshold : false;
  const votingPercentage = getPercentage(votingPower);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-muted rounded-md">
        <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="font-medium text-accent">
          {formatAmount(votingPower)} {tokenSymbol}
        </span>
        <span className="text-accent text-sm">({votingPercentage.toFixed(2)}%)</span>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Your Voting Power</h3>

      {/* Main Voting Power */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-accent to-template-purple mb-3">
          <span className="text-2xl font-bold text-white">{votingPercentage.toFixed(1)}%</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {formatAmount(votingPower)} {tokenSymbol}
        </p>
        <p className="text-sm text-foreground-muted">of {formatAmount(totalSupply)} total supply</p>
      </div>

      {/* Breakdown */}
      <div className="space-y-3 mb-6">
        <div className="flex justify-between items-center p-3 bg-background-secondary rounded-md">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <span className="text-foreground-secondary">Your Balance</span>
          </div>
          <span className="font-medium text-foreground">
            {formatAmount(yourBalance)} {tokenSymbol}
          </span>
        </div>

        <div className="flex justify-between items-center p-3 bg-background-secondary rounded-md">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="text-foreground-secondary">Delegated to You</span>
          </div>
          <span className="font-medium text-foreground">
            {formatAmount(delegatedToYou)} {tokenSymbol}
          </span>
        </div>
      </div>

      {/* Thresholds */}
      <div className="space-y-3">
        {proposalThreshold && (
          <div className={`p-3 rounded-md ${canPropose ? 'bg-status-success/10 border border-status-success' : 'bg-background-secondary'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {canPropose ? (
                  <svg className="w-5 h-5 text-status-success" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-foreground-muted" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <span className={canPropose ? 'text-status-success' : 'text-foreground-secondary'}>
                  Proposal Threshold
                </span>
              </div>
              <span className={`font-medium ${canPropose ? 'text-status-success' : 'text-foreground'}`}>
                {formatAmount(proposalThreshold)} {tokenSymbol}
              </span>
            </div>
            {!canPropose && (
              <p className="text-xs text-foreground-muted mt-2">
                Need {formatAmount(proposalThreshold - votingPower)} more {tokenSymbol} to create proposals
              </p>
            )}
          </div>
        )}

        {quorum && (
          <div className="p-3 bg-background-secondary rounded-md">
            <div className="flex items-center justify-between">
              <span className="text-foreground-secondary">Quorum Requirement</span>
              <span className="font-medium text-foreground">
                {formatAmount(quorum)} {tokenSymbol}
              </span>
            </div>
            <div className="mt-2 h-2 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${Math.min(getPercentage(votingPower) / getPercentage(quorum) * 100, 100)}%` }}
              />
            </div>
            <p className="text-xs text-foreground-muted mt-1">
              Your vote is {(votingPower * 100n / quorum).toString()}% of quorum
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
