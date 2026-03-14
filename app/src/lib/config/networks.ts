/**
 * Network Configuration (Vite)
 */

import type { NetworkConfig } from '@/types/wallet';

export const NETWORKS: Record<string, NetworkConfig> = {
  sandbox: {
    id: 'sandbox',
    name: 'Local Sandbox',
    nodeUrl: 'http://localhost:8080',
    chainId: 31337,
    rollupVersion: 1,
    sponsoredFpcAddress: import.meta.env.VITE_SANDBOX_SPONSORED_FPC_ADDRESS,
    cloakMembershipsAddress: import.meta.env.VITE_SANDBOX_CLOAK_MEMBERSHIPS_ADDRESS,
    keeperAddress: import.meta.env.VITE_SANDBOX_KEEPER_ADDRESS,
  },

  devnet: {
    id: 'devnet',
    name: 'Aztec Devnet',
    nodeUrl: 'https://v4-devnet-2.aztec-labs.com',
    chainId: 11155111,
    rollupVersion: 615022430,
    sponsoredFpcAddress: import.meta.env.VITE_SPONSORED_FPC_ADDRESS,
    cloakRegistryAddress: import.meta.env.VITE_CLOAK_REGISTRY_ADDRESS,
    cloakMembershipsAddress: import.meta.env.VITE_CLOAK_MEMBERSHIPS_ADDRESS,
    keeperAddress: import.meta.env.VITE_KEEPER_ADDRESS,
  },

  testnet: {
    id: 'testnet',
    name: 'Aztec Testnet',
    nodeUrl: import.meta.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/',
    chainId: 11155111,
    rollupVersion: 1,
    sponsoredFpcAddress: import.meta.env.VITE_SPONSORED_FPC_ADDRESS,
    keeperAddress: import.meta.env.VITE_KEEPER_ADDRESS,
  },
};

export function getDefaultNetwork(): NetworkConfig {
  const networkId = import.meta.env.VITE_DEFAULT_NETWORK || 'testnet';
  return NETWORKS[networkId] || NETWORKS.testnet;
}

export function getNetwork(id: string): NetworkConfig | undefined {
  return NETWORKS[id];
}
