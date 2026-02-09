/**
 * Contract Class Cache — Pre-warm Contract Class Publishing
 *
 * Optimizes deployment by checking and publishing contract classes in the background
 * when the wallet connects, rather than waiting until deployment time.
 *
 * Privacy: Only checks public on-chain data (contract class registration status).
 * No private data is exposed.
 */

import type { Wallet } from '@aztec/aztec.js/wallet';

// Cache for class publishing status by class ID
const classPublishingCache = new Map<string, {
  isPublished: boolean;
  checkedAt: number;
  publishPromise?: Promise<void>;
}>();

// TTL for cache entries (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Pre-warming promise to avoid duplicate calls
let preWarmingPromise: Promise<void> | null = null;

/**
 * Check if a contract class is already published on-chain.
 * Caches the result to avoid repeated RPC calls.
 */
export async function isClassPublished(wallet: Wallet, classId: string): Promise<boolean> {
  const cached = classPublishingCache.get(classId);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.isPublished;
  }

  try {
    const { Fr } = await import('@aztec/foundation/curves/bn254');
    const metadata = await wallet.getContractClassMetadata(Fr.fromString(classId));
    const isPublished = metadata && metadata.isContractClassPubliclyRegistered;

    classPublishingCache.set(classId, {
      isPublished: !!isPublished,
      checkedAt: Date.now(),
    });

    return !!isPublished;
  } catch {
    // Not found — not published
    classPublishingCache.set(classId, {
      isPublished: false,
      checkedAt: Date.now(),
    });
    return false;
  }
}

/**
 * Pre-warm the GovernorBravoCloak contract class by publishing it if needed.
 * This runs in the background when the wallet connects.
 *
 * @param wallet - The connected wallet
 * @param senderAddress - Optional sender address for the transaction
 * @param paymentMethod - Optional payment method for sponsored transactions
 */
export async function preWarmGovernorBravoClass(
  wallet: Wallet,
  senderAddress?: any,
  paymentMethod?: any
): Promise<void> {
  // Avoid duplicate pre-warming
  if (preWarmingPromise) {
    return preWarmingPromise;
  }

  preWarmingPromise = (async () => {
    try {
      console.log('[ContractClassCache] Pre-warming GovernorBravoCloak class...');

      // Load the artifact
      const { getGovernorBravoCloakArtifact } = await import('@/lib/aztec/contracts');
      const artifact = await getGovernorBravoCloakArtifact();

      // Get the contract class from the artifact
      const { getContractClassFromArtifact } = await import('@aztec/stdlib/contract');
      const contractClass = await getContractClassFromArtifact(artifact);
      const classId = contractClass.id.toString();

      // Check if already published
      const alreadyPublished = await isClassPublished(wallet, classId);
      if (alreadyPublished) {
        console.log('[ContractClassCache] GovernorBravoCloak class already published');
        return;
      }

      // Publish the class
      console.log('[ContractClassCache] Publishing GovernorBravoCloak class...');
      const { publishContractClass } = await import('@aztec/aztec.js/deployment');
      const { AztecAddress } = await import('@aztec/aztec.js/addresses');

      const publishInteraction = await publishContractClass(wallet, artifact);
      // `from` is required - use provided senderAddress or ZERO for signerless
      await publishInteraction.send({
        from: senderAddress ?? AztecAddress.ZERO,
        ...(paymentMethod ? { fee: { paymentMethod } } : {}),
      }).wait({ timeout: 120000 });

      // Update cache
      classPublishingCache.set(classId, {
        isPublished: true,
        checkedAt: Date.now(),
      });

      console.log('[ContractClassCache] GovernorBravoCloak class published successfully');
    } catch (err: any) {
      const msg = err?.message ?? '';
      // Ignore if already published (race condition with another user)
      if (msg.includes('Existing nullifier') || msg.includes('already registered')) {
        console.log('[ContractClassCache] GovernorBravoCloak class was published by another party');
        return;
      }
      // Non-fatal — deployment will publish if needed
      console.warn('[ContractClassCache] Pre-warming failed (non-fatal):', msg);
    } finally {
      preWarmingPromise = null;
    }
  })();

  return preWarmingPromise;
}

/**
 * Get the cached class ID for GovernorBravoCloak.
 * Returns null if the artifact hasn't been loaded yet.
 */
export async function getGovernorBravoClassId(): Promise<string | null> {
  try {
    const { getGovernorBravoCloakArtifact } = await import('@/lib/aztec/contracts');
    const artifact = await getGovernorBravoCloakArtifact();

    const { getContractClassFromArtifact } = await import('@aztec/stdlib/contract');
    const contractClass = await getContractClassFromArtifact(artifact);

    return contractClass.id.toString();
  } catch {
    return null;
  }
}

/**
 * Check if pre-warming is currently in progress.
 */
export function isPreWarmingInProgress(): boolean {
  return preWarmingPromise !== null;
}

/**
 * Wait for any in-progress pre-warming to complete.
 * Returns immediately if no pre-warming is in progress.
 */
export async function waitForPreWarming(): Promise<void> {
  if (preWarmingPromise) {
    console.log('[ContractClassCache] Waiting for pre-warming to complete...');
    await preWarmingPromise;
  }
}

/**
 * Clear the class publishing cache (useful for testing or after errors).
 */
export function clearClassCache(): void {
  classPublishingCache.clear();
  preWarmingPromise = null;
}
