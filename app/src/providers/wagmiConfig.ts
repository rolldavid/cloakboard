import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// Use wagmi createConfig directly (not RainbowKit's getDefaultConfig) to avoid
// WalletConnect SDK initialization on every page load. WC causes COOP warnings
// and network errors when no project ID is configured.
// RainbowKit still works as a UI wrapper — it just uses this config.
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
