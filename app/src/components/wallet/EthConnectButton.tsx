'use client';

import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

interface EthConnectButtonProps {
  /** Optional: show compact version */
  compact?: boolean;
}

/**
 * Cloak-styled Ethereum wallet connect button using RainbowKit.
 */
export function EthConnectButton({ compact }: EthConnectButtonProps) {
  if (compact) {
    return (
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
          const connected = mounted && account && chain;
          return (
            <button
              onClick={connected ? openAccountModal : openConnectModal}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                connected
                  ? 'bg-background-secondary text-foreground hover:bg-background-tertiary'
                  : 'bg-ring text-white hover:bg-ring/90'
              }`}
            >
              {connected
                ? `${account.displayName}${chain.unsupported ? ' (Wrong Network)' : ''}`
                : 'Connect Ethereum'}
            </button>
          );
        }}
      </ConnectButton.Custom>
    );
  }

  return <ConnectButton />;
}
