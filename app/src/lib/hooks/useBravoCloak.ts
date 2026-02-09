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
  isServiceReady: boolean;
}

export interface DelegationInfo {
  delegate: string;
  votingPower: bigint;
  delegatedPower: bigint;
  totalVotes: bigint;
}

// Type for dynamically loaded modules
type BravoModules = {
  AztecAddress: any;
  GovernorBravoCloakService: any;
  getGovernorBravoCloakArtifact: () => Promise<any>;
};

// Dynamically loaded modules cache (global)
let bravoModules: BravoModules | null = null;

async function loadBravoModules(): Promise<BravoModules> {
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
    isServiceReady: false,
  });

  // Use refs to avoid stale closure issues - ref.current always has latest value
  const serviceRef = useRef<any>(null);
  const modulesRef = useRef<BravoModules | null>(null);
  // Track connected address in ref for guard check (avoids dependency on state)
  const connectedAddressRef = useRef<string | null>(null);

  // Initialize service when client is available
  useEffect(() => {
    if (!client) {
      serviceRef.current = null;
      modulesRef.current = null;
      connectedAddressRef.current = null;
      setState(prev => ({ ...prev, isServiceReady: false, isConnected: false, cloakAddress: null }));
      return;
    }

    let mounted = true;

    loadBravoModules().then((modules) => {
      if (!mounted || !client) return;
      modulesRef.current = modules;  // Cache modules in ref
      const wallet = client.getWallet();
      const senderAddress = client.getAddress();
      const paymentMethod = client.getPaymentMethod?.();
      const service = new modules.GovernorBravoCloakService(wallet, senderAddress, paymentMethod);
      serviceRef.current = service;
      setState(prev => ({ ...prev, isServiceReady: true }));
    }).catch((err) => {
      console.error('[useBravoCloak] Failed to load modules:', err);
      if (mounted) {
        setState(prev => ({ ...prev, error: 'Failed to load Governor Bravo modules', isServiceReady: false }));
      }
    });

    return () => { mounted = false; };
  }, [client]);

  const connectToCloak = useCallback(async (address: string) => {
    const service = serviceRef.current;
    if (!service) {
      setState(prev => ({ ...prev, error: 'Bravo service not initialized' }));
      return;
    }

    // Validate address - must be a valid Aztec address format
    if (!address || !address.startsWith('0x') || address.length < 60) {
      console.error('[useBravoCloak] Invalid cloak address:', address);
      setState(prev => ({ ...prev, error: `Invalid cloak address: ${address?.slice(0, 20) || 'empty'}...` }));
      return;
    }

    // GUARD: Don't re-connect if already connected to same address
    if (connectedAddressRef.current === address) {
      console.log('[useBravoCloak] Already connected to', address);
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const modules = modulesRef.current || await loadBravoModules();
      const artifact = await modules.getGovernorBravoCloakArtifact();
      console.log('[useBravoCloak] Connecting to cloak:', address);
      await service.connect(modules.AztecAddress.fromString(address), artifact);
      connectedAddressRef.current = address;  // Track connected address in ref
      setState({
        isConnected: true,
        cloakAddress: address,
        isLoading: false,
        error: null,
        isServiceReady: true,
      });
      console.log('[useBravoCloak] Connected successfully');
    } catch (err) {
      console.error('[useBravoCloak] Connect error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect to Bravo Cloak';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, []);

  const getVotingPower = useCallback(async (address: string): Promise<bigint> => {
    const service = serviceRef.current;
    const modules = modulesRef.current;
    if (!service || !modules) throw new Error('Bravo service not initialized');
    return service.getVotes(modules.AztecAddress.fromString(address));
  }, []);

  const getTotalVotingPower = useCallback(async (): Promise<bigint> => {
    const service = serviceRef.current;
    if (!service) throw new Error('Bravo service not initialized');
    return service.getTotalVotingPower();
  }, []);

  const getDelegationInfo = useCallback(async (address: string): Promise<DelegationInfo> => {
    const service = serviceRef.current;
    const modules = modulesRef.current;
    if (!service || !modules) throw new Error('Bravo service not initialized');
    return service.getDelegationInfo(modules.AztecAddress.fromString(address));
  }, []);

  const getDelegate = useCallback(async (address: string): Promise<string> => {
    const service = serviceRef.current;
    const modules = modulesRef.current;
    if (!service || !modules) throw new Error('Bravo service not initialized');
    return service.getDelegate(modules.AztecAddress.fromString(address));
  }, []);

  const delegate = useCallback(async (delegateeAddress: string) => {
    const service = serviceRef.current;
    const modules = modulesRef.current;
    if (!service || !modules) throw new Error('Bravo service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      await service.delegate(modules.AztecAddress.fromString(delegateeAddress));
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, []);

  const selfDelegate = useCallback(async (ownAddress: string) => {
    const service = serviceRef.current;
    const modules = modulesRef.current;
    if (!service || !modules) throw new Error('Bravo service not initialized');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      // Self-delegate = delegate to your own address (OZ ERC20Votes pattern)
      await service.delegate(modules.AztecAddress.fromString(ownAddress));
      setState(prev => ({ ...prev, isLoading: false }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to self-delegate';
      setState(prev => ({ ...prev, isLoading: false, error: errorMessage }));
      throw err;
    }
  }, []);

  const getProposalCount = useCallback(async (): Promise<number> => {
    const service = serviceRef.current;
    if (!service) throw new Error('Bravo service not initialized');
    return service.getProposalCount();
  }, []);

  const getName = useCallback(async (): Promise<string> => {
    const service = serviceRef.current;
    if (!service) throw new Error('Bravo service not initialized');
    return service.getName();
  }, []);

  const getProposalThreshold = useCallback(async (): Promise<bigint> => {
    const service = serviceRef.current;
    if (!service) throw new Error('Bravo service not initialized');
    return service.getProposalThreshold();
  }, []);

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
