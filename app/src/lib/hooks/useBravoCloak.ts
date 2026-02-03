'use client';

/**
 * useBravoCloak — Hook for interacting with Governor Bravo Cloak contracts
 *
 * Uses GovernorBravoCloakService (not the generic CloakContractService)
 * so that delegation, voting power, and proposal methods call the correct ABI.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface BravoCloakState {
  isConnected: boolean;
  cloakAddress: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface DelegationInfo {
  delegate: string;
  votingPower: bigint;
  delegatedPower: bigint;
  totalVotes: bigint;
}

// Dynamically loaded modules cache
let bravoModules: {
  AztecAddress: any;
  GovernorBravoCloakService: any;
  getGovernorBravoCloakArtifact: () => Promise<any>;
} | null = null;

async function loadBravoModules() {
  if (bravoModules) return bravoModules;

  const [addressesModule, bravoModule, contractsModule] = await Promise.all([
    import('@aztec/aztec.js/addresses'),
    import('../templates/GovernorBravoCloakService'),
    import('../aztec/contracts'),
  ]);

  bravoModules = {
    AztecAddress: addressesModule.AztecAddress,
    GovernorBravoCloakService: bravoModule.GovernorBravoCloakService,
    getGovernorBravoCloakArtifact: contractsModule.getGovernorBravoCloakArtifact,
  };

  return bravoModules;
}

type AztecClientType = {
  getWallet: () => any;
  getAddress: () => any;
  getPaymentMethod?: () => any;
  isInitialized: () => boolean;
} | null;

export function useBravoCloak(client: AztecClientType) {
  const [state, setState] = useState<BravoCloakState>({
    isConnected: false,
    cloakAddress: null,
    isLoading: false,
    error: null,
  });

  const [bravoService, setBravoService] = useState<any>(null);
  const serviceRef = useRef<any>(null);

  // Initialize service when client is available
  useEffect(() => {
    if (!client) return;

    let mounted = true;

    loadBravoModules().then((modules) => {
      if (!mounted || !client) return;
      const wallet = client.getWallet();
      const senderAddress = client.getAddress();
      const paymentMethod = client.getPaymentMethod?.();
      const service = new modules.GovernorBravoCloakService(wallet, senderAddress, paymentMethod);
      serviceRef.current = service;
      setBravoService(service);
    }).catch((err) => {
      console.error('[useBravoCloak] Failed to load modules:', err);
      if (mounted) {
        setState(prev => ({ ...prev, error: 'Failed to load Governor Bravo modules' }));
      }
    });

    return () => { mounted = false; };
  }, [client]);

  const connectToCloak = useCallback(async (address: string) => {
    if (!bravoService) {
      setState(prev => ({ ...prev, error: 'Bravo service not initialized' }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const modules = await loadBravoModules();
      const artifact = await modules.getGovernorBravoCloakArtifact();
      await bravoService.connect(modules.AztecAddress.fromString(address), artifact);
      setState({
        isConnected: true,
        cloakAddress: address,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Bravo Cloak';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [bravoService]);

  const getVotingPower = useCallback(async (address: string): Promise<bigint> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    const modules = await loadBravoModules();
    return bravoService.getVotes(modules.AztecAddress.fromString(address));
  }, [bravoService]);

  const getTotalVotingPower = useCallback(async (): Promise<bigint> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    return bravoService.getTotalVotingPower();
  }, [bravoService]);

  const getDelegationInfo = useCallback(async (address: string): Promise<DelegationInfo> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    const modules = await loadBravoModules();
    return bravoService.getDelegationInfo(modules.AztecAddress.fromString(address));
  }, [bravoService]);

  const getDelegate = useCallback(async (address: string): Promise<string> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    const modules = await loadBravoModules();
    return bravoService.getDelegate(modules.AztecAddress.fromString(address));
  }, [bravoService]);

  const delegate = useCallback(async (delegateeAddress: string) => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const modules = await loadBravoModules();
      await bravoService.delegate(modules.AztecAddress.fromString(delegateeAddress));
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [bravoService]);

  const selfDelegate = useCallback(async (ownAddress: string) => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const modules = await loadBravoModules();
      // Self-delegate = delegate to your own address (OZ ERC20Votes pattern)
      await bravoService.delegate(modules.AztecAddress.fromString(ownAddress));
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to self-delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, [bravoService]);

  const getProposalCount = useCallback(async (): Promise<number> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    return bravoService.getProposalCount();
  }, [bravoService]);

  const getName = useCallback(async (): Promise<string> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    return bravoService.getName();
  }, [bravoService]);

  const getProposalThreshold = useCallback(async (): Promise<bigint> => {
    if (!bravoService) throw new Error('Bravo service not initialized');
    return bravoService.getProposalThreshold();
  }, [bravoService]);

  return {
    ...state,
    connectToCloak,
    getVotingPower,
    getTotalVotingPower,
    getDelegationInfo,
    getDelegate,
    delegate,
    selfDelegate,
    getProposalCount,
    getName,
    getProposalThreshold,
  };
}
