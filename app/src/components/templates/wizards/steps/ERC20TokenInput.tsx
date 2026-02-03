'use client';

import React from 'react';
import type { ERC20TokenConfig } from '@/types/tokenGate';

interface ERC20TokenInputProps {
  config: ERC20TokenConfig;
  onChange: (config: ERC20TokenConfig) => void;
  /** Whether Eth wallet is connected */
  isEthConnected?: boolean;
  /** Connected Eth address */
  ethAddress?: string;
  /** Resolved token info from chain */
  tokenInfo?: {
    name: string;
    symbol: string;
    decimals: number;
  } | null;
}

export function ERC20TokenInput({
  config,
  onChange,
  isEthConnected,
  ethAddress,
  tokenInfo,
}: ERC20TokenInputProps) {
  const update = (updates: Partial<ERC20TokenConfig>) => {
    onChange({ ...config, ...updates });
  };

  return (
    <div className="space-y-4">
      {!isEthConnected && (
        <div className="p-4 border border-status-warning/30 bg-status-warning/5 rounded-md">
          <p className="text-sm text-status-warning">
            Connect an Ethereum wallet to auto-detect token info.
            You can still configure manually without connecting.
          </p>
        </div>
      )}

      {isEthConnected && ethAddress && (
        <div className="p-3 bg-background-tertiary rounded-md flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-success" />
          <p className="text-xs text-foreground-muted font-mono">
            {ethAddress.slice(0, 6)}...{ethAddress.slice(-4)}
          </p>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          ERC20 Token Address *
        </label>
        <input
          type="text"
          value={config.tokenAddress}
          onChange={(e) => update({ tokenAddress: e.target.value })}
          placeholder="0x..."
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring font-mono text-sm"
        />
      </div>

      {tokenInfo && (
        <div className="p-3 bg-background-secondary rounded-md">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{tokenInfo.name}</span>
            <span className="text-xs text-foreground-muted px-2 py-0.5 bg-background-tertiary rounded">
              {tokenInfo.symbol}
            </span>
            <span className="text-xs text-foreground-muted">
              ({tokenInfo.decimals} decimals)
            </span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">Chain</label>
        <select
          value={config.chainId}
          onChange={(e) => update({ chainId: parseInt(e.target.value) })}
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        >
          <option value={1}>Ethereum Mainnet</option>
          <option value={8453}>Base</option>
          <option value={11155111}>Sepolia (Testnet)</option>
        </select>
      </div>

      <details className="group">
        <summary className="text-sm text-foreground-muted cursor-pointer hover:text-foreground-secondary">
          Advanced Settings
        </summary>
        <div className="mt-3">
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Balance Storage Slot
          </label>
          <input
            type="number"
            min={0}
            value={config.balanceSlot}
            onChange={(e) => update({ balanceSlot: parseInt(e.target.value) || 0 })}
            className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          />
          <p className="text-xs text-foreground-muted mt-1">
            Storage slot index for the token's balances mapping. Default 0 works for most ERC20 tokens.
            OpenZeppelin tokens typically use slot 0.
          </p>
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Min Balance to Join
          </label>
          <input
            type="text"
            value={config.minMembershipBalance}
            onChange={(e) => update({ minMembershipBalance: e.target.value })}
            placeholder="1"
            className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Min Balance to Propose
          </label>
          <input
            type="text"
            value={config.minProposerBalance}
            onChange={(e) => update({ minProposerBalance: e.target.value })}
            placeholder="100"
            className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          />
        </div>
      </div>

      <div className="p-3 bg-background-tertiary rounded-md">
        <p className="text-xs text-foreground-muted">
          Members prove their ERC20 balance using a ZK proof generated client-side.
          No bridge contracts are needed — the proof verifies Ethereum state directly.
          Your wallet address and exact balance are never revealed on-chain.
        </p>
      </div>
    </div>
  );
}
