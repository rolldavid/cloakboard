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
  MoltCloakService: any;
  GovernorBravoCloakService: any;
  CloakRegistryService: any;
  getMoltCloakArtifact: any;
  getGovernorBravoCloakArtifact: any;
  getCloakRegistryArtifact: any;
  loadContractArtifact: any;
} | null = null;

async function loadDeployModules() {
  if (deployModules) return deployModules;

  const [addressesModule, frModule, contractsModule, abiModule, moltModule, bravoModule, registryModule] = await Promise.all([
    import('@aztec/aztec.js/addresses'),
    import('@aztec/foundation/curves/bn254'),
    import('../aztec/contracts'),
    import('@aztec/stdlib/abi'),
    import('../templates/MoltCloakService'),
    import('../templates/GovernorBravoCloakService'),
    import('../templates/CloakRegistryService'),
  ]);

  deployModules = {
    AztecAddress: addressesModule.AztecAddress,
    Fr: frModule.Fr,
    CloakContractService: contractsModule.CloakContractService,
    MoltCloakService: moltModule.MoltCloakService,
    GovernorBravoCloakService: bravoModule.GovernorBravoCloakService,
    CloakRegistryService: registryModule.CloakRegistryService,
    getMoltCloakArtifact: contractsModule.getMoltCloakArtifact,
    getGovernorBravoCloakArtifact: contractsModule.getGovernorBravoCloakArtifact,
    getCloakRegistryArtifact: contractsModule.getCloakRegistryArtifact,
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
      const registryService = new modules.CloakRegistryService(currentClient.getWallet(), admin, paymentMethod);
      let registryUsable = false;
      const storedRegistryAddr = useAztecStore.getState().registryAddress;

      if (storedRegistryAddr) {
        try {
          const registryArtifact = await modules.getCloakRegistryArtifact();
          await registryService.connect(
            modules.AztecAddress.fromString(storedRegistryAddr),
            registryArtifact
          );

          const available = await registryService.isNameAvailable(cloakName);
          if (!available) {
            throw new Error(`The name "${cloakName}" is already taken on-chain. Please choose a different name.`);
          }
          registryUsable = true;
        } catch (err: any) {
          // If the error is about the name being taken, rethrow
          if (err?.message?.includes('already taken')) throw err;
          // Otherwise log and continue (registry may not be deployed yet)
          console.warn('[useDeployCloak] Registry check failed, continuing:', err?.message);
        }
      } else {
        // No registry deployed yet — deploy one and persist address
        try {
          const registryArtifact = await modules.getCloakRegistryArtifact();
          const registryAddr = await registryService.deploy(registryArtifact);
          const registryAddrStr = registryAddr.toString();
          useAztecStore.getState().setRegistryAddress(registryAddrStr);
          registryUsable = true;
        } catch (err) {
          console.warn('[useDeployCloak] Failed to deploy registry, continuing without:', err);
        }
      }

      if (templateId === 1) {
        // Governor Bravo — uses GovernorBravoCloakService with its own artifact
        const artifact = await modules.getGovernorBravoCloakArtifact();
        const wallet = currentClient.getWallet();
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
        };

        const classId = modules.Fr.random();
        const addr = await bravoService.deploy(bravoConfig, artifact, classId);
        deployedAddress = addr.toString();

        // Auto-self-delegate so the creator's voting power is immediately active
        // (OZ ERC20Votes pattern: tokens are inert until delegated)
        try {
          await bravoService.delegate(admin);
        } catch (delegateErr) {
          // Non-fatal: cloak is deployed, user can manually self-delegate later
          console.warn('[useDeployCloak] Auto-self-delegation failed (non-fatal):', delegateErr);
        }
      } else if (templateId === 10) {
        // Molt Cloak — uses MoltCloakService with its own artifact and constructor args
        const artifact = await modules.getMoltCloakArtifact();
        const wallet = currentClient.getWallet();
        const moltService = new modules.MoltCloakService(wallet, admin, paymentMethod);

        const moltConfig = {
          name: config.name || template.name,
          description: config.description || '',
          privacyPreset: (config.privacyPreset === 'maximum' ? 'maximum' : 'balanced') as 'maximum' | 'balanced',
          publicHoursPerDay: config.publicHoursPerDay ?? 24,
          allowHoursProposals: config.allowHoursProposals ?? false,
          minPublicHours: config.minPublicHours ?? 0,
          postCooldownSeconds: config.postCooldownSeconds ?? 60,
          commentCooldownSeconds: config.commentCooldownSeconds ?? 30,
          dailyCommentLimit: config.dailyCommentLimit ?? 100,
          votingPeriodBlocks: config.votingPeriodBlocks ?? config.votingSettings?.duration ?? 100,
        };

        const classId = modules.Fr.random();
        const addr = await moltService.deploy(moltConfig, artifact, classId, admin);
        deployedAddress = addr.toString();
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

      // Register the name on-chain in the CloakRegistry
      if (registryUsable && registryService.isConnected()) {
        try {
          await registryService.register(cloakName, modules.AztecAddress.fromString(deployedAddress));
        } catch (err) {
          console.warn('[useDeployCloak] Failed to register name on-chain:', err);
          // Non-fatal: the cloak is deployed, just not registered
        }
      }

      // Record for rate limiting
      recordCloakDeployment();

      // Persist to Zustand store
      addCloak({
        address: deployedAddress,
        name: cloakName,
        slug: nameToSlug(cloakName),
        ownerAddress: adminAddress,
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
        isPubliclySearchable: config.isPubliclySearchable ?? false,
        isPubliclyViewable: config.isPubliclyViewable ?? true,
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
