'use client';

/**
 * useDeployCloak — Template-aware Cloak deployment hook
 *
 * Bridges wizard config → on-chain Aztec contract deployment.
 * Uses the wallet context client for actual deployment when connected,
 * falls back to local-only persistence when client isn't available.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useAztecStore } from '@/store/aztecStore';
import { getTemplateMetadata } from '@/lib/constants/templates';
import type { TemplateId } from '@/lib/templates/TemplateFactory';
import {
  checkCloakDeploymentRateLimit,
  recordCloakDeployment,
} from '../rateLimit/cloakDeploymentRateLimiter';
import { nameToSlug } from '../utils/slug';

export interface DeployCloakState {
  isDeploying: boolean;
  error: string | null;
  deployedAddress: string | null;
}

// Dynamically loaded modules cache
let deployModules: {
  AztecAddress: any;
  Fr: any;
  CloakContractService: any;
  GovernorBravoCloakService: any;
  CloakRegistryService: any;
  CloakMembershipsService: any;
  MembershipRole: any;
  getGovernorBravoCloakArtifact: any;
  getCloakRegistryArtifact: any;
  getCloakMembershipsArtifact: any;
  loadContractArtifact: any;
} | null = null;

async function loadDeployModules() {
  if (deployModules) return deployModules;

  // Try to use pre-warmed modules from ArtifactPrewarmer first (saves 5-10s)
  try {
    const { getPrewarmedModules } = await import('../deployment');
    const prewarmed = getPrewarmedModules();
    if (prewarmed) {
      console.log('[useDeployCloak] Using pre-warmed modules');
      const { MembershipRole } = await import('../templates/CloakMembershipsService');
      deployModules = {
        AztecAddress: prewarmed.AztecAddress,
        Fr: prewarmed.Fr,
        CloakContractService: prewarmed.CloakContractService,
        GovernorBravoCloakService: prewarmed.GovernorBravoCloakService,
        CloakRegistryService: prewarmed.CloakRegistryService,
        CloakMembershipsService: prewarmed.CloakMembershipsService,
        MembershipRole,
        getGovernorBravoCloakArtifact: prewarmed.getGovernorBravoCloakArtifact,
        getCloakRegistryArtifact: prewarmed.getCloakRegistryArtifact,
        getCloakMembershipsArtifact: prewarmed.getCloakMembershipsArtifact,
        loadContractArtifact: prewarmed.loadContractArtifact,
      };
      return deployModules;
    }
  } catch {
    // Pre-warmed modules not available, load fresh
  }

  const [addressesModule, frModule, contractsModule, abiModule, bravoModule, registryModule, membershipsModule] = await Promise.all([
    import('@aztec/aztec.js/addresses'),
    import('@aztec/foundation/curves/bn254'),
    import('../aztec/contracts'),
    import('@aztec/stdlib/abi'),
    import('../templates/GovernorBravoCloakService'),
    import('../templates/CloakRegistryService'),
    import('../templates/CloakMembershipsService'),
  ]);

  deployModules = {
    AztecAddress: addressesModule.AztecAddress,
    Fr: frModule.Fr,
    CloakContractService: contractsModule.CloakContractService,
    GovernorBravoCloakService: bravoModule.GovernorBravoCloakService,
    CloakRegistryService: registryModule.CloakRegistryService,
    CloakMembershipsService: membershipsModule.CloakMembershipsService,
    MembershipRole: membershipsModule.MembershipRole,
    getGovernorBravoCloakArtifact: contractsModule.getGovernorBravoCloakArtifact,
    getCloakRegistryArtifact: contractsModule.getCloakRegistryArtifact,
    getCloakMembershipsArtifact: contractsModule.getCloakMembershipsArtifact,
    loadContractArtifact: abiModule.loadContractArtifact,
  };

  return deployModules;
}

/**
 * Hook for deploying Cloaks with actual Aztec contract deployment
 */
export function useDeployCloak() {
  const { client, isClientReady, account } = useWalletContext();
  const addCloak = useAztecStore((state: any) => state.addCloak);

  // Use refs so the deploy callback always sees the latest values
  const clientRef = useRef(client);
  const isClientReadyRef = useRef(isClientReady);
  const accountRef = useRef(account);
  useEffect(() => { clientRef.current = client; }, [client]);
  useEffect(() => { isClientReadyRef.current = isClientReady; }, [isClientReady]);
  useEffect(() => { accountRef.current = account; }, [account]);

  // Pre-warm WASM modules while user fills in the wizard form
  useEffect(() => {
    loadDeployModules().catch(() => {});
  }, []);

  const [state, setState] = useState<DeployCloakState>({
    isDeploying: false,
    error: null,
    deployedAddress: null,
  });

  /**
   * Deploy a Cloak contract on-chain and persist to local store.
   * If the client isn't ready yet (account still deploying), waits up to 120s.
   */
  const deploy = useCallback(async (
    templateId: number,
    config: any,
  ): Promise<string | null> => {
    setState({ isDeploying: true, error: null, deployedAddress: null });

    try {
      // Rate limit check
      const rateLimitResult = checkCloakDeploymentRateLimit();
      if (!rateLimitResult.allowed) {
        throw new Error(rateLimitResult.message);
      }

      // Wait for any in-progress pre-warming or preparation to complete
      // This prevents race conditions where multiple operations try to use the account simultaneously
      try {
        const { waitForPreWarming, waitForPreparation } = await import('../deployment');
        await Promise.all([
          waitForPreWarming(),
          waitForPreparation(),
        ]);
      } catch {
        // Non-fatal — deployment module might not be loaded
      }

      const template = getTemplateMetadata(templateId as TemplateId);
      let deployedAddress: string;

      // Wait for client to become ready (account deployment may still be in progress)
      if (!clientRef.current || !isClientReadyRef.current) {
        const maxWait = 600_000; // 10 minutes
        const pollInterval = 500;
        let waited = 0;
        while ((!clientRef.current || !isClientReadyRef.current) && waited < maxWait) {
          await new Promise((r) => setTimeout(r, pollInterval));
          waited += pollInterval;
        }
        if (!clientRef.current || !isClientReadyRef.current) {
          throw new Error('Aztec client did not become ready within 10 minutes. Please refresh and try again.');
        }
      }

      const currentClient = clientRef.current;
      // Use the TestWallet's actual account address (Schnorr account registered in the wallet)
      // rather than the MultiAuth address from the auth system, since TestWallet
      // only knows about accounts created via createSchnorrAccount().
      const walletAddress = currentClient.getAddress();
      const adminAddress = walletAddress?.toString() ?? accountRef.current?.address;
      if (!adminAddress) {
        throw new Error('No wallet connected. Please connect your wallet before deploying.');
      }

      const modules = await loadDeployModules();
      const admin = walletAddress ?? modules.AztecAddress.fromString(adminAddress);
      const paymentMethod = currentClient.getPaymentMethod?.();

      // --- On-chain name uniqueness check via CloakRegistry ---
      const cloakName = config.name || template.name;
      const wallet = currentClient.getWallet();
      const storedRegistryAddr = useAztecStore.getState().registryAddress;

      // PARALLEL: Load artifact + Check name availability at the same time
      // This saves ~5-10s by not waiting for name check before loading artifact
      let registryService: InstanceType<typeof modules.CloakRegistryService> | null = null;
      let artifact: any = null;
      let nameCheckError: Error | null = null;

      const parallelOps: Promise<void>[] = [];

      // Load GovernorBravo artifact (only for templateId === 1)
      if (templateId === 1) {
        parallelOps.push(
          modules.getGovernorBravoCloakArtifact().then((a: any) => { artifact = a; })
        );
      }

      // Check name availability in registry
      if (storedRegistryAddr) {
        parallelOps.push(
          (async () => {
            try {
              const registryArtifact = await modules.getCloakRegistryArtifact();
              registryService = new modules.CloakRegistryService(wallet, admin, paymentMethod);
              await registryService.connect(modules.AztecAddress.fromString(storedRegistryAddr), registryArtifact);

              const isAvailable = await registryService.isNameAvailable(cloakName);
              if (!isAvailable) {
                nameCheckError = new Error(`The cloak name "${cloakName}" is already taken. Please choose a different name.`);
              }
            } catch (err: any) {
              if (err?.message?.includes('already taken')) {
                nameCheckError = err;
              } else {
                console.warn('[useDeployCloak] Registry not available:', err?.message);
                registryService = null;
              }
            }
          })()
        );
      }

      // Wait for parallel operations to complete
      if (parallelOps.length > 0) {
        await Promise.all(parallelOps);
      }

      // Check if name was taken
      if (nameCheckError) {
        throw nameCheckError;
      }

      if (templateId === 1) {
        // Governor Bravo — artifact already loaded in parallel above
        const bravoService = new modules.GovernorBravoCloakService(wallet, admin, paymentMethod);

        // Build council members array (pad to 12 with zero addresses)
        const rawCouncil: string[] = (config.councilMembers ?? []).filter((m: string) => m?.trim());
        const councilMembers: string[] = [];
        for (let i = 0; i < 12; i++) {
          councilMembers.push(i < rawCouncil.length ? rawCouncil[i] : '0x0000000000000000000000000000000000000000000000000000000000000000');
        }

        const bravoConfig = {
          name: config.name || template.name,
          description: config.description || '',
          governanceToken: admin, // Use deployer as governance token placeholder
          votingDelay: config.votingDelay ?? 14400,
          votingPeriod: config.votingPeriod ?? 100800,
          proposalThreshold: config.proposalThreshold ?? 0n,
          quorumNumerator: config.quorumVotes ? config.quorumVotes / BigInt(1e16) : 4n, // Convert to numerator (default 4%)
          quorumDenominator: 100n,
          lateQuorumExtension: 0,
          timelockDelay: config.timelockDelay ?? 28800,
          proposalGuardian: admin,
          tokenGate: config.tokenGate,
          cloakMode: (config.cloakMode ?? 0) as 0 | 1 | 2,
          councilMembers: councilMembers,
          councilThreshold: config.councilThreshold ?? 1,
          emergencyThreshold: config.emergencyThreshold ?? 0,
          isPubliclyViewable: config.visibility === 'open',
        };

        const deployClassId = modules.Fr.random();
        const addr = await bravoService.deploy(bravoConfig, artifact, deployClassId);
        deployedAddress = addr.toString();

        // Note: Auto-self-delegation is skipped because the admin doesn't have
        // voting power notes at deployment time. Users can self-delegate later
        // via the Delegation page once they have token holdings.
      } else {
        // Standard PrivateCloak deployment
        const cloakService = new modules.CloakContractService(currentClient);

        // Map wizard config to deployment params
        const name = config.name || template.name;
        const votingDuration = config.votingSettings?.duration
          ?? config.votingPeriod
          ?? 100; // blocks
        const quorumThreshold = config.votingSettings?.quorum
          ?? config.quorumThreshold
          ?? 1;

        // Determine membership mode and token gate params
        const membershipMode = config.tokenGate?.method === 'erc20-token' ? 1 : 0;
        const tokenAddress = config.tokenGate?.aztecToken?.existingTokenAddress
          ? modules.AztecAddress.fromString(config.tokenGate.aztecToken.existingTokenAddress)
          : undefined;
        const erc20Hash = config.tokenGate?.erc20Token?.tokenAddress
          ? modules.Fr.fromString(config.tokenGate.erc20Token.tokenAddress)
          : undefined;
        const erc20MinBalance = config.tokenGate?.erc20Token?.minMembershipBalance
          ? BigInt(config.tokenGate.erc20Token.minMembershipBalance)
          : 0n;

        deployedAddress = await cloakService.deployCloak(
          name,
          admin,
          votingDuration,
          quorumThreshold,
          membershipMode,
          undefined, // tokenGateAddress — not used yet
          tokenAddress,
          erc20Hash,
          erc20MinBalance,
        );
      }

      // Post-deploy: record membership and register name on-chain.
      // For first-time users, the signing key note was synced during deployAccount(),
      // so send() calls through the account entrypoint work immediately.
      // For returning users, the note should be synced by the time they deploy a cloak
      // (WalletProvider runs syncAccountNotes before setIsClientReady).
      // If either call fails (note not synced, network error), fall back to pending queue
      // which is retried by WalletProvider.processPendingOperations on next sync.
      const storedMembershipsAddr = useAztecStore.getState().membershipsAddress;

      // Record membership (public function — addMembership has no access control)
      if (storedMembershipsAddr) {
        try {
          const membershipsArtifact = await modules.getCloakMembershipsArtifact();
          const membershipsService = new modules.CloakMembershipsService(wallet, admin, paymentMethod);
          await membershipsService.connect(modules.AztecAddress.fromString(storedMembershipsAddr), membershipsArtifact);
          await membershipsService.addMembership(
            admin,
            modules.AztecAddress.fromString(deployedAddress),
            modules.MembershipRole.CREATOR,
          );
          console.log('[useDeployCloak] Membership recorded on-chain:', admin.toString(), '->', deployedAddress);
        } catch (memErr: any) {
          console.warn('[useDeployCloak] addMembership failed, queueing for retry:', memErr?.message);
          useAztecStore.getState().addPendingMembership({
            userAddress: admin.toString(),
            cloakAddress: deployedAddress,
            role: modules.MembershipRole.CREATOR,
          });
        }
      }

      // Register name in CloakRegistry (private function — needs signing key note)
      if (storedRegistryAddr) {
        try {
          // registryService may already be connected from the name availability check above
          if (!registryService) {
            const registryArtifact = await modules.getCloakRegistryArtifact();
            registryService = new modules.CloakRegistryService(wallet, admin, paymentMethod);
            await registryService.connect(modules.AztecAddress.fromString(storedRegistryAddr), registryArtifact);
          }
          await registryService.register(cloakName, modules.AztecAddress.fromString(deployedAddress));
          console.log('[useDeployCloak] Name registered on-chain:', cloakName, '->', deployedAddress);
        } catch (regErr: any) {
          console.warn('[useDeployCloak] register() failed, queueing for retry:', regErr?.message);
          useAztecStore.getState().addPendingRegistration({
            name: cloakName,
            cloakAddress: deployedAddress,
          });
        }
      } else {
        console.warn('[useDeployCloak] No registry address, skipping name registration');
      }

      // Record for rate limiting
      recordCloakDeployment();

      // Persist to Zustand store
      addCloak({
        address: deployedAddress,
        name: cloakName,
        slug: nameToSlug(cloakName),
        role: modules.MembershipRole.CREATOR,
        memberCount: config.cloakMode === 1 ? (config.councilMembers?.filter((m: string) => m?.trim()).length ?? 1) : 1,
        proposalCount: 0,
        templateId,
        privacyLevel: template.defaultPrivacy,
        lastActivityAt: Date.now(),
        pendingActions: 0,
        membershipMode: config.cloakMode === 1 ? undefined : (config.tokenGate?.method === 'erc20-token' ? 'erc20-token' : 'aztec-token'),
        tokenAddress: config.tokenGate?.aztecToken?.existingTokenAddress,
        erc20TokenAddress: config.tokenGate?.erc20Token?.tokenAddress,
        erc20ChainId: config.tokenGate?.erc20Token?.chainId,
        minimumBalance: config.tokenGate?.aztecToken?.minMembershipBalance
          ?? config.tokenGate?.erc20Token?.minMembershipBalance,
        cloakMode: config.cloakMode ?? 0,
        councilMembers: config.councilMembers?.filter((m: string) => m?.trim()),
        councilThreshold: config.councilThreshold,
        emergencyThreshold: config.emergencyThreshold,
        isPubliclyViewable: config.visibility === 'open',
      });

      // Keep isDeploying true so the DeploymentExperience stays visible
      // for the success state and handles the redirect itself.
      setState({ isDeploying: true, error: null, deployedAddress });
      return deployedAddress;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deployment failed';
      console.error('[useDeployCloak] Error:', err);
      setState({ isDeploying: false, error: msg, deployedAddress: null });
      return null;
    }
  }, [addCloak]);

  return {
    ...state,
    deploy,
    isClientReady,
    isWalletConnected: !!account,
  };
}
