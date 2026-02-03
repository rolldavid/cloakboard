'use client';

import React, { ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mainnet, base, sepolia } from 'wagmi/chains';

/**
 * Ethereum Wallet Provider
 *
 * Provides Ethereum wallet connectivity via RainbowKit/wagmi for ERC20 token gating.
 * This is separate from the Aztec wallet — users connect both when using ERC20 gating.
 */

const config = getDefaultConfig({
  appName: 'Cloak',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'realm-cloak',
  chains: [mainnet, base, sepolia],
});

const queryClient = new QueryClient();

interface EthWalletProviderProps {
  children: ReactNode;
}

export function EthWalletProvider({ children }: EthWalletProviderProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
