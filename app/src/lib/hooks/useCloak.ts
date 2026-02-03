'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  checkCloakDeploymentRateLimit,
  recordCloakDeployment,
  getCloakDeploymentRateLimitStatus,
  type RateLimitResult,
} from '../rateLimit/cloakDeploymentRateLimiter';

// Types only - no runtime imports from Aztec
export interface CloakState {
  isConnected: boolean;
  cloakAddress: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface Proposal {
  id: number;
  creator: string;
  title: string;
  description: string;
  proposalType: number;
  targetAddress: string;
  value: bigint;
  startBlock: number;
  endBlock: number;
  executed: boolean;
}

export interface VoteTally {
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  totalVotes: bigint;
}

// Dynamically loaded modules cache
let aztecModules: {
  AztecAddress: any;
  AztecClient: any;
  CloakContractService: any;
} | null = null;

/**
 * Dynamically load Aztec modules
 * This ensures Aztec SDK is only loaded client-side
 */
async function loadAztecModules() {
  if (aztecModules) return aztecModules;

  const [addressesModule, clientModule, contractsModule] = await Promise.all([
    import('@aztec/aztec.js/addresses'),
    import('../aztec/client'),
    import('../aztec/contracts'),
  ]);

  aztecModules = {
    AztecAddress: addressesModule.AztecAddress,
    AztecClient: clientModule.AztecClient,
    CloakContractService: contractsModule.CloakContractService,
  };

  return aztecModules;
}

/**
 * Type for the client parameter - accepts any to avoid importing AztecClient type
 */
type AztecClientType = {
  getWallet: () => any;
  getPaymentMethod: () => any;
  isInitialized: () => boolean;
} | null;

export function useCloak(client: AztecClientType) {
  const [state, setState] = useState<CloakState>({
    isConnected: false,
    cloakAddress: null,
    isLoading: false,
    error: null,
  });

  const [cloakService, setCloakService] = useState<any>(null);
  const [isModulesLoaded, setIsModulesLoaded] = useState(false);

  // Load Aztec modules when client is available
  useEffect(() => {
    if (!client) return;

    let mounted = true;

    loadAztecModules().then((modules) => {
      if (mounted && client) {
        const service = new modules.CloakContractService(client);
        setCloakService(service);
        setIsModulesLoaded(true);
      }
    }).catch((err) => {
      console.error('Failed to load Aztec modules:', err);
      setState(prev => ({ ...prev, error: 'Failed to load Aztec modules' }));
    });

    return () => {
      mounted = false;
    };
  }, [client]);

  const connectToCloak = useCallback(async (address: string) => {
    if (!cloakService) {
      setState(prev => ({ ...prev, error: 'Aztec client not initialized' }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await cloakService.connectToCloak(address);
      setState({
        isConnected: true,
        cloakAddress: address,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Cloak';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw err;
    }
  }, [cloakService]);

  const deployCloak = useCallback(async (
    name: string,
    adminAddress: string,
    votingDuration: number,
    quorumThreshold: number
  ) => {
    if (!cloakService) {
      setState(prev => ({ ...prev, error: 'Aztec client not initialized' }));
      return;
    }

    // Validate admin address before proceeding
    if (!adminAddress) {
      const errorMsg = 'Admin address is required for Cloak deployment';
      setState(prev => ({ ...prev, error: errorMsg }));
      throw new Error(errorMsg);
    }

    // Check rate limit before attempting deployment
    const rateLimitResult = checkCloakDeploymentRateLimit();
    if (!rateLimitResult.allowed) {
      setState(prev => ({
        ...prev,
        error: rateLimitResult.message,
      }));
      throw new Error(rateLimitResult.message);
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const modules = await loadAztecModules();

      const admin = modules.AztecAddress.fromString(adminAddress);

      const cloakAddress = await cloakService.deployCloak(
        name,
        admin,
        votingDuration,
        quorumThreshold
      );

      // Record successful deployment for rate limiting
      recordCloakDeployment();

      setState({
        isConnected: true,
        cloakAddress,
        isLoading: false,
        error: null,
      });

      return cloakAddress;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to deploy Cloak';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw err;
    }
  }, [cloakService]);

  const addMember = useCallback(async (memberAddress: string, votingPower: bigint) => {
    if (!cloakService) throw new Error('Cloak service not initialized');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const modules = await loadAztecModules();
      await cloakService.addMember(modules.AztecAddress.fromString(memberAddress), votingPower);
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add member';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const createProposal = useCallback(async (
    title: string,
    description: string,
    proposalType: number,
    targetAddress: string,
    value: bigint
  ) => {
    if (!cloakService) throw new Error('Cloak service not initialized');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const modules = await loadAztecModules();
      await cloakService.createProposal(
        title,
        description,
        proposalType,
        modules.AztecAddress.fromString(targetAddress),
        value
      );
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create proposal';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const castVote = useCallback(async (proposalId: bigint, support: number) => {
    if (!cloakService) throw new Error('Cloak service not initialized');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await cloakService.castVote(proposalId, support);
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to cast vote';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const executeProposal = useCallback(async (proposalId: bigint) => {
    if (!cloakService) throw new Error('Cloak service not initialized');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      await cloakService.executeProposal(proposalId);
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute proposal';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const getMemberCount = useCallback(async (): Promise<number> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    return cloakService.getMemberCount();
  }, [cloakService]);

  const getProposalCount = useCallback(async (): Promise<number> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    return cloakService.getProposalCount();
  }, [cloakService]);

  const getProposal = useCallback(async (proposalId: bigint): Promise<Proposal> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    return cloakService.getProposal(proposalId);
  }, [cloakService]);

  const getVoteTally = useCallback(async (proposalId: bigint): Promise<VoteTally> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    return cloakService.getVoteTally(proposalId);
  }, [cloakService]);

  const getName = useCallback(async (): Promise<string> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    return cloakService.getName();
  }, [cloakService]);

  const getPrivateVotingPower = useCallback(async (ownerAddress: string): Promise<bigint> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    const modules = await loadAztecModules();
    return cloakService.getPrivateVotingPower(modules.AztecAddress.fromString(ownerAddress));
  }, [cloakService]);

  const delegate = useCallback(async (delegateeAddress: string) => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const modules = await loadAztecModules();
      await cloakService.delegate(modules.AztecAddress.fromString(delegateeAddress));
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const selfDelegate = useCallback(async () => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      await cloakService.removeDelegation();
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to self-delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [cloakService]);

  const getDelegate = useCallback(async (address: string): Promise<string> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    const modules = await loadAztecModules();
    return cloakService.getDelegate(modules.AztecAddress.fromString(address));
  }, [cloakService]);

  const getVotingPower = useCallback(async (address: string): Promise<bigint> => {
    if (!cloakService) throw new Error('Cloak service not initialized');
    const modules = await loadAztecModules();
    return cloakService.getVotes(modules.AztecAddress.fromString(address));
  }, [cloakService]);

  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      cloakAddress: null,
      isLoading: false,
      error: null,
    });
  }, []);

  /**
   * Check if Cloak deployment is allowed under rate limit
   * Returns rate limit status including remaining deployments
   */
  const checkDeploymentRateLimit = useCallback((): RateLimitResult => {
    return checkCloakDeploymentRateLimit();
  }, []);

  /**
   * Get detailed rate limit status
   */
  const getDeploymentRateLimitStatus = useCallback(() => {
    return getCloakDeploymentRateLimitStatus();
  }, []);

  return {
    ...state,
    isModulesLoaded,
    cloakService,
    connectToCloak,
    deployCloak,
    addMember,
    createProposal,
    castVote,
    executeProposal,
    getName,
    getMemberCount,
    getProposalCount,
    getProposal,
    getVoteTally,
    getPrivateVotingPower,
    delegate,
    selfDelegate,
    getDelegate,
    getVotingPower,
    disconnect,
    checkDeploymentRateLimit,
    getDeploymentRateLimitStatus,
  };
}
