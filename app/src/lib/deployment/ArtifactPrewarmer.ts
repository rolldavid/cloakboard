/**
 * Artifact Prewarmer — Eager Load Deployment Artifacts
 *
 * Optimizes deployment by pre-loading all deployment modules and JSON artifacts
 * when the user reaches the review step, rather than loading them on-demand.
 *
 * This eliminates the artifact loading delay during actual deployment.
 *
 * Privacy: Only loads public artifact files. No private data involved.
 */

// Track pre-warming status
let prewarmPromise: Promise<void> | null = null;
let isPrewarmed = false;

// Cached module references
let cachedModules: {
  AztecAddress: any;
  Fr: any;
  CloakContractService: any;
  GovernorBravoCloakService: any;
  CloakRegistryService: any;
  CloakMembershipsService: any;
  getGovernorBravoCloakArtifact: any;
  getCloakRegistryArtifact: any;
  getCloakMembershipsArtifact: any;
  loadContractArtifact: any;
  getContractClassFromArtifact: any;
  publishContractClass: any;
  Contract: any;
} | null = null;

/**
 * Pre-warm all deployment-related artifacts and modules.
 * Call this when the user enters the review step.
 *
 * Non-blocking: Returns immediately, loading happens in background.
 * Safe to call multiple times — subsequent calls return cached promise.
 */
export async function prewarmDeploymentArtifacts(): Promise<void> {
  // Return existing promise if already running
  if (prewarmPromise) {
    return prewarmPromise;
  }

  // Skip if already prewarmed
  if (isPrewarmed && cachedModules) {
    return Promise.resolve();
  }

  prewarmPromise = (async () => {
    try {
      console.log('[ArtifactPrewarmer] Pre-warming deployment artifacts...');
      const startTime = performance.now();

      // Load all modules in parallel
      const [
        addressesModule,
        frModule,
        contractsModule,
        abiModule,
        contractModule,
        deploymentModule,
        bravoModule,
        registryModule,
        membershipsModule,
      ] = await Promise.all([
        import('@aztec/aztec.js/addresses'),
        import('@aztec/foundation/curves/bn254'),
        import('@/lib/aztec/contracts'),
        import('@aztec/stdlib/abi'),
        import('@aztec/aztec.js/contracts'),
        import('@aztec/aztec.js/deployment'),
        import('@/lib/templates/GovernorBravoCloakService'),
        import('@/lib/templates/CloakRegistryService'),
        import('@/lib/templates/CloakMembershipsService'),
      ]);

      // Pre-load the actual JSON artifacts (these trigger dynamic imports)
      const [bravoArtifact, registryArtifact, membershipsArtifact] = await Promise.all([
        contractsModule.getGovernorBravoCloakArtifact(),
        contractsModule.getCloakRegistryArtifact(),
        contractsModule.getCloakMembershipsArtifact(),
      ]);

      // Cache all modules
      cachedModules = {
        AztecAddress: addressesModule.AztecAddress,
        Fr: frModule.Fr,
        CloakContractService: contractsModule.CloakContractService,
        GovernorBravoCloakService: bravoModule.GovernorBravoCloakService,
        CloakRegistryService: registryModule.CloakRegistryService,
        CloakMembershipsService: membershipsModule.CloakMembershipsService,
        getGovernorBravoCloakArtifact: contractsModule.getGovernorBravoCloakArtifact,
        getCloakRegistryArtifact: contractsModule.getCloakRegistryArtifact,
        getCloakMembershipsArtifact: contractsModule.getCloakMembershipsArtifact,
        loadContractArtifact: abiModule.loadContractArtifact,
        getContractClassFromArtifact: (await import('@aztec/stdlib/contract')).getContractClassFromArtifact,
        publishContractClass: deploymentModule.publishContractClass,
        Contract: contractModule.Contract,
      };

      isPrewarmed = true;
      const elapsed = performance.now() - startTime;
      console.log(`[ArtifactPrewarmer] Pre-warming complete in ${elapsed.toFixed(0)}ms`);
    } catch (err) {
      console.warn('[ArtifactPrewarmer] Pre-warming failed (non-fatal):', err);
      // Non-fatal — modules will be loaded on-demand during deployment
    } finally {
      prewarmPromise = null;
    }
  })();

  return prewarmPromise;
}

/**
 * Get the pre-warmed modules if available.
 * Returns null if pre-warming hasn't completed yet.
 *
 * Use this in deployment code to skip re-loading modules.
 */
export function getPrewarmedModules(): typeof cachedModules {
  return cachedModules;
}

/**
 * Check if artifacts have been pre-warmed.
 */
export function isArtifactsPrewarmed(): boolean {
  return isPrewarmed && cachedModules !== null;
}

/**
 * Check if pre-warming is currently in progress.
 */
export function isPrewarmingInProgress(): boolean {
  return prewarmPromise !== null;
}

/**
 * Clear the prewarmed cache (useful for testing or memory cleanup).
 */
export function clearPrewarmedCache(): void {
  cachedModules = null;
  isPrewarmed = false;
  prewarmPromise = null;
}
