'use client';

import React from 'react';

interface TokenBalance {
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
  valueUsd?: number;
  iconUrl?: string;
}

interface TreasuryBalanceProps {
  tokens: TokenBalance[];
  totalValueUsd?: number;
  isLoading?: boolean;
  privacyLevel?: 'maximum' | 'balanced' | 'transparent';
}

export function TreasuryBalance({
  tokens,
  totalValueUsd,
  isLoading = false,
  privacyLevel = 'balanced',
}: TreasuryBalanceProps) {
  const formatBalance = (balance: bigint, decimals: number) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = balance / divisor;
    const fractionalPart = balance % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 4);
    return `${integerPart.toLocaleString()}.${fractionalStr}`;
  };

  const formatUsd = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-md p-6 animate-shimmer">
        <div className="h-8 bg-background-tertiary rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-6 bg-background-tertiary rounded w-1/4" />
              <div className="h-6 bg-background-tertiary rounded w-1/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Maximum privacy hides balances
  if (privacyLevel === 'maximum') {
    return (
      <div className="bg-card border border-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <h3 className="text-lg font-semibold text-foreground">Treasury Balance</h3>
        </div>
        <div className="text-center py-8 text-foreground-muted">
          <p className="font-medium">Balances are private</p>
          <p className="text-sm mt-1">Only members can view treasury details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Treasury Balance</h3>
        {totalValueUsd !== undefined && (
          <span className="text-2xl font-bold text-accent">
            {formatUsd(totalValueUsd)}
          </span>
        )}
      </div>

      {tokens.length === 0 ? (
        <div className="text-center py-8 text-foreground-muted">
          <p>No assets in treasury</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tokens.map((token) => (
            <div
              key={token.symbol}
              className="flex items-center justify-between p-3 bg-background-secondary rounded-md"
            >
              <div className="flex items-center gap-3">
                {token.iconUrl ? (
                  <img src={token.iconUrl} alt={token.symbol} className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                    {token.symbol.slice(0, 2)}
                  </div>
                )}
                <div>
                  <p className="font-medium text-foreground">{token.symbol}</p>
                  <p className="text-sm text-foreground-muted">{token.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-foreground">
                  {formatBalance(token.balance, token.decimals)}
                </p>
                {token.valueUsd !== undefined && (
                  <p className="text-sm text-foreground-muted">{formatUsd(token.valueUsd)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
