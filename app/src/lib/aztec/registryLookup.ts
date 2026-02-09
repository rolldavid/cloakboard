/**
 * Lightweight CloakRegistry Lookup
 *
 * Provides fast slug→address resolution without requiring a full wallet client.
 * Uses a minimal TestWallet for read-only queries to the CloakRegistry.
 *
 * This is separate from the main AztecClient because:
 * 1. Full wallet initialization takes 30-60+ seconds (account deployment, proof generation)
 * 2. CloakRegistry is PUBLIC - anyone can read from it
 * 3. Slug resolution should be fast (<5 seconds)
 */

import { NETWORKS } from '@/lib/config/networks';

// Cached lookup client - initialized once, reused for all lookups
let lookupClientPromise: Promise<LookupClient> | null = null;

interface LookupClient {
  nodeUrl: string;
  registryAddress: string;
  testWallet: any;
  registryContract: any;
}

/**
 * Initialize a lightweight client for registry lookups only.
 * This is much faster than full wallet initialization.
 */
async function initLookupClient(): Promise<LookupClient> {
  // Get network config
  const networkId = process.env.NEXT_PUBLIC_AZTEC_NETWORK || 'devnet';
  const network = NETWORKS[networkId as keyof typeof NETWORKS] || NETWORKS.devnet;

  if (!network.cloakRegistryAddress) {
    throw new Error('CloakRegistry address not configured');
  }

  console.log('[registryLookup] Initializing lightweight lookup client...');

  // Create node connection
  const { createAztecNodeClient, waitForNode } = await import('@aztec/aztec.js/node');
  const node = createAztecNodeClient(network.nodeUrl);
  await waitForNode(node);

  // Create a minimal TestWallet for read-only queries
  // This doesn't require account creation or deployment
  const { TestWallet } = await import('@aztec/test-wallet/client/lazy');
  const testWallet = await TestWallet.create(node, { proverEnabled: false });

  // Load CloakRegistry artifact and connect
  const { getCloakRegistryArtifact } = await import('@/lib/aztec/contracts');
  const { Contract } = await import('@aztec/aztec.js/contracts');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  const artifact = await getCloakRegistryArtifact();
  const registryAddress = AztecAddress.fromString(network.cloakRegistryAddress);

  // Connect to CloakRegistry contract — wrap with clean names proxy so callers
  // can use e.g. `get_cloak_by_name` instead of `__aztec_nr_internals__get_cloak_by_name`
  const { wrapContractWithCleanNames } = await import('@/lib/aztec/contracts');
  const registryContract = wrapContractWithCleanNames(await Contract.at(registryAddress, artifact, testWallet));

  console.log('[registryLookup] Lookup client ready');

  return {
    nodeUrl: network.nodeUrl,
    registryAddress: network.cloakRegistryAddress,
    testWallet,
    registryContract,
  };
}

/**
 * Get the lookup client (creates one if needed)
 */
async function getLookupClient(): Promise<LookupClient> {
  if (!lookupClientPromise) {
    lookupClientPromise = initLookupClient().catch((err) => {
      // Reset on failure so we can retry
      lookupClientPromise = null;
      throw err;
    });
  }
  return lookupClientPromise;
}

/**
 * Look up a cloak address by name/slug from CloakRegistry.
 * Returns null if not found.
 */
export async function lookupCloakByName(nameOrSlug: string): Promise<string | null> {
  try {
    const client = await getLookupClient();

    // Pad name to 31 characters (matches contract's str<31> type)
    const paddedName = nameOrSlug.slice(0, 31).padEnd(31, '\0');

    // Call get_cloak_by_name on the registry
    const { AztecAddress } = await import('@aztec/aztec.js/addresses');

    const result = await client.registryContract.methods
      .get_cloak_by_name(paddedName)
      .simulate({});

    // Check if result is valid (non-zero address)
    const addrStr = result?.toString?.() || result;
    if (!addrStr || addrStr === AztecAddress.ZERO?.toString() || addrStr === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }

    return addrStr;
  } catch (err: any) {
    console.warn('[registryLookup] Failed to lookup cloak:', err?.message);
    return null;
  }
}

/**
 * Check if a cloak name is registered in the registry.
 */
export async function isNameRegistered(name: string): Promise<boolean> {
  const addr = await lookupCloakByName(name);
  return addr !== null;
}

/**
 * Reset the lookup client (for testing or network switch)
 */
export function resetLookupClient(): void {
  lookupClientPromise = null;
}
