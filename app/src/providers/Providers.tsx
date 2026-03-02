import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { wagmiConfig } from './wagmiConfig';

const queryClient = new QueryClient();
const solanaEndpoint = clusterApiUrl('mainnet-beta');
const solanaWallets = [new PhantomWalletAdapter()];

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <ConnectionProvider endpoint={solanaEndpoint}>
          <WalletProvider wallets={solanaWallets} autoConnect={false}>
            {children}
          </WalletProvider>
        </ConnectionProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
