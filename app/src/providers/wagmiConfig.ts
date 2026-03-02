import { createConfig, http } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// Target MetaMask specifically so Phantom's Ethereum injection doesn't hijack the connection.
export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia],
  connectors: [injected({ target: 'metaMask' })],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
