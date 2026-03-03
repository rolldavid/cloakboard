import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

// No connectors registered eagerly — probing window.ethereum at init time
// interferes with Phantom's Solana provider. MetaMask connector is created
// on-demand in EthereumAuthButton when the user clicks "MetaMask".
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors: [],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
