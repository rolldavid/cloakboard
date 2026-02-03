/**
 * Network Configuration
 *
 * Defines the available Aztec networks for the application.
 */

import type { NetworkConfig } from '@/types/wallet';

/**
 * Available networks
 *
 * All networks use TestWallet with appropriate prover settings:
 * - sandbox: proverEnabled=false (fast local testing)
 * - devnet/testnet/mainnet: proverEnabled=true (generates valid ZK proofs)
 */
export const NETWORKS: Record<string, NetworkConfig> = {
  // Local sandbox for development (no proofs required)
  sandbox: {
    id: 'sandbox',
    name: 'Local Sandbox',
    nodeUrl: 'http://localhost:8080',
    chainId: 31337,
    rollupVersion: 1,
  },

  // Devnet - development network with sponsored fees
  devnet: {
    id: 'devnet',
    name: 'Aztec Devnet',
    nodeUrl: process.env.NEXT_PUBLIC_AZTEC_NODE_URL || 'https://devnet-6.aztec-labs.com/',
    chainId: 31337,
    rollupVersion: 1,
    sponsoredFpcAddress: process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS,
  },

  // Testnet - public test network
  testnet: {
    id: 'testnet',
    name: 'Aztec Testnet',
    nodeUrl: process.env.NEXT_PUBLIC_TESTNET_NODE_URL || 'https://testnet.aztec.network',
    chainId: 677868,
    rollupVersion: 1,
    sponsoredFpcAddress: process.env.NEXT_PUBLIC_TESTNET_SPONSORED_FPC_ADDRESS,
  },

  // Mainnet - production network
  mainnet: {
    id: 'mainnet',
    name: 'Aztec Mainnet',
    nodeUrl: process.env.NEXT_PUBLIC_MAINNET_NODE_URL || 'https://mainnet.aztec.network',
    chainId: 1, // Ethereum mainnet chain ID
    rollupVersion: 1,
    sponsoredFpcAddress: process.env.NEXT_PUBLIC_MAINNET_SPONSORED_FPC_ADDRESS,
  },
};

/**
 * Get the default network based on environment
 */
export function getDefaultNetwork(): NetworkConfig {
  const networkId = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'devnet';
  return NETWORKS[networkId] || NETWORKS.devnet;
}

/**
 * Get network by ID
 */
export function getNetwork(id: string): NetworkConfig | undefined {
  return NETWORKS[id];
}

/**
 * Get all available network IDs
 */
export function getNetworkIds(): string[] {
  return Object.keys(NETWORKS);
}

/**
 * Validate a network URL
 */
export async function validateNetworkUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}
