/**
 * Deployment Preparer — Pre-build Deployment Transactions
 *
 * Optimizes deployment by building the deployment transaction while the user
 * reviews their configuration, rather than building it after they click deploy.
 *
 * Privacy: All preparation is local computation on public data.
 * No private data is leaked until the user actually deploys.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';

/**
 * Configuration hash for cache invalidation
 */
function hashConfig(config: any): string {
  return JSON.stringify(config, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

/**
 * Prepared deployment ready to send
 */
export interface PreparedDeployment {
  /** The deploy interaction ready to send */
  deployInteraction: any;
  /** Pre-computed contract address */
  expectedAddress: string;
  /** Whether the name is available in registry */
  nameAvailable: boolean;
  /** Hash of config for invalidation checking */
  configHash: string;
  /** Timestamp when prepared */
  preparedAt: number;
  /** The artifact used (cached for deployment) */
  artifact: any;
  /** Contract class ID */
  classId: string;
  /** Whether class is already published */
  classPublished: boolean;
}

// TTL for prepared deployments (5 minutes)
const PREPARATION_TTL_MS = 5 * 60 * 1000;

// Cached prepared deployment
let preparedDeployment: PreparedDeployment | null = null;

// Preparation promise to avoid duplicate work
let preparationPromise: Promise<PreparedDeployment | null> | null = null;

/**
 * Prepare a deployment transaction in the background.
 * Call this when entering the review step.
 *
 * @param wallet - The connected wallet
 * @param admin - Admin address for the cloak
 * @param config - The wizard configuration
 * @param senderAddress - Optional sender address
 * @param paymentMethod - Optional payment method
 */
export async function prepareDeployment(
  wallet: Wallet,
  admin: AztecAddress,
  config: any,
  senderAddress?: AztecAddress,
  paymentMethod?: any
): Promise<PreparedDeployment | null> {
  const configHash = hashConfig(config);

  // Return cached if valid
  if (preparedDeployment &&
      preparedDeployment.configHash === configHash &&
      Date.now() - preparedDeployment.preparedAt < PREPARATION_TTL_MS) {
    console.log('[DeploymentPreparer] Using cached prepared deployment');
    return preparedDeployment;
  }

  // Return existing promise if preparation in progress
  if (preparationPromise) {
    return preparationPromise;
  }

  preparationPromise = (async () => {
    try {
      console.log('[DeploymentPreparer] Preparing deployment transaction...');
      const startTime = performance.now();

      // Wait for any in-progress contract class pre-warming to complete
      // This prevents race conditions where both prewarming and preparation
      // try to use the wallet simultaneously
      const { waitForPreWarming } = await import('./ContractClassCache');
      await waitForPreWarming();

      // Import required modules
      const { AztecAddress: AztecAddressClass } = await import('@aztec/aztec.js/addresses');
      const { Fr } = await import('@aztec/foundation/curves/bn254');
      const { Contract } = await import('@aztec/aztec.js/contracts');
      const { getContractClassFromArtifact } = await import('@aztec/stdlib/contract');
      const { getGovernorBravoCloakArtifact, getCloakRegistryArtifact } = await import('@/lib/aztec/contracts');
      const { CloakRegistryService } = await import('@/lib/templates/CloakRegistryService');
      const { useAztecStore } = await import('@/store/aztecStore');

      // Load artifact
      const artifact = await getGovernorBravoCloakArtifact();

      // Get contract class ID
      const contractClass = await getContractClassFromArtifact(artifact);
      const classId = contractClass.id.toString();

      // Check if class is already published
      let classPublished = false;
      try {
        const metadata = await wallet.getContractClassMetadata(contractClass.id);
        classPublished = metadata && metadata.isContractClassPubliclyRegistered;
      } catch {
        // Not found — not published
      }

      // Check name availability if registry is configured
      let nameAvailable = true;
      const cloakName = config.name || 'Untitled Cloak';
      const storedRegistryAddr = useAztecStore.getState().registryAddress;

      if (storedRegistryAddr) {
        try {
          const registryArtifact = await getCloakRegistryArtifact();
          const registryService = new CloakRegistryService(wallet, senderAddress, paymentMethod);
          await registryService.connect(AztecAddressClass.fromString(storedRegistryAddr), registryArtifact);
          nameAvailable = await registryService.isNameAvailable(cloakName);
        } catch (err) {
          console.warn('[DeploymentPreparer] Registry check failed:', err);
          // Assume available, actual deployment will recheck
        }
      }

      // Build council members array (pad to 12 with zero addresses)
      const rawCouncil: string[] = (config.councilMembers ?? []).filter((m: string) => m?.trim());
      const councilMembers: AztecAddress[] = [];
      for (let i = 0; i < 12; i++) {
        if (i < rawCouncil.length && rawCouncil[i]) {
          councilMembers.push(AztecAddressClass.fromString(rawCouncil[i]));
        } else {
          councilMembers.push(AztecAddressClass.fromBigInt(0n));
        }
      }

      // Determine membership mode
      const membershipMode = config.tokenGate?.method === 'aztec-token' ? 0
        : config.tokenGate?.method === 'erc20-token' ? 1 : 0;

      // Build deploy transaction (but don't send)
      const contractSalt = Fr.random();
      const deployInteraction = Contract.deploy(wallet, artifact, [
        config.name || 'Untitled Cloak',
        admin,
        config.votingDelay ?? 14400,
        config.votingPeriod ?? 100800,
        config.proposalThreshold ?? 0n,
        config.quorumVotes ? config.quorumVotes / BigInt(1e16) : 4n,
        100n,
        0,
        config.timelockDelay ?? 28800,
        admin,
        membershipMode,
        config.tokenGate?.aztecToken?.existingTokenAddress
          ? AztecAddressClass.fromString(config.tokenGate.aztecToken.existingTokenAddress)
          : AztecAddressClass.fromBigInt(0n),
        config.tokenGate?.erc20Token
          ? hashString(config.tokenGate.erc20Token.tokenAddress)
          : Fr.ZERO,
        config.tokenGate?.erc20Token
          ? BigInt(config.tokenGate.erc20Token.minMembershipBalance)
          : 0n,
        config.cloakMode ?? 0,
        councilMembers,
        rawCouncil.length,
        config.councilThreshold ?? 1,
        config.emergencyThreshold ?? 0,
        config.visibility === 'open',
      ]);

      // Get expected address (doesn't send transaction)
      const instance = await deployInteraction.getInstance({ contractAddressSalt: contractSalt });
      const expectedAddress = instance.address.toString();

      const prepared: PreparedDeployment = {
        deployInteraction,
        expectedAddress,
        nameAvailable,
        configHash,
        preparedAt: Date.now(),
        artifact,
        classId,
        classPublished,
      };

      preparedDeployment = prepared;
      const elapsed = performance.now() - startTime;
      console.log(`[DeploymentPreparer] Preparation complete in ${elapsed.toFixed(0)}ms`);

      return prepared;
    } catch (err) {
      console.warn('[DeploymentPreparer] Preparation failed (non-fatal):', err);
      return null;
    } finally {
      preparationPromise = null;
    }
  })();

  return preparationPromise;
}

/**
 * Get the prepared deployment if available and valid.
 *
 * @param configHash - Hash of current config to validate against
 */
export function getPreparedDeployment(configHash: string): PreparedDeployment | null {
  if (!preparedDeployment) {
    return null;
  }

  // Check config hash matches
  if (preparedDeployment.configHash !== configHash) {
    console.log('[DeploymentPreparer] Config changed, invalidating prepared deployment');
    return null;
  }

  // Check TTL
  if (Date.now() - preparedDeployment.preparedAt > PREPARATION_TTL_MS) {
    console.log('[DeploymentPreparer] Prepared deployment expired');
    preparedDeployment = null;
    return null;
  }

  return preparedDeployment;
}

/**
 * Invalidate the prepared deployment.
 * Call this when going back from review or when config changes.
 */
export function invalidatePreparedDeployment(): void {
  console.log('[DeploymentPreparer] Invalidating prepared deployment');
  preparedDeployment = null;
  preparationPromise = null;
}

/**
 * Check if a prepared deployment is available.
 */
export function hasPreparedDeployment(): boolean {
  return preparedDeployment !== null &&
         Date.now() - preparedDeployment.preparedAt < PREPARATION_TTL_MS;
}

/**
 * Check if preparation is currently in progress.
 */
export function isPreparationInProgress(): boolean {
  return preparationPromise !== null;
}

/**
 * Wait for any in-progress preparation to complete.
 * Returns immediately if no preparation is in progress.
 */
export async function waitForPreparation(): Promise<void> {
  if (preparationPromise) {
    console.log('[DeploymentPreparer] Waiting for preparation to complete...');
    await preparationPromise;
  }
}

/**
 * Compute config hash for a configuration object.
 * Use this to check if prepared deployment is still valid.
 */
export function computeConfigHash(config: any): string {
  return hashConfig(config);
}

// Helper to hash strings (matches GovernorBravoCloakService)
function hashString(str: string): any {
  // Lazy import to avoid circular dependency
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let hash = 0n;
  for (let i = 0; i < data.length; i++) {
    hash = (hash * 31n + BigInt(data[i])) % (2n ** 254n);
  }
  // Return a mock Fr-like object — actual Fr will be used in deployment
  return { value: hash, toString: () => hash.toString() };
}
