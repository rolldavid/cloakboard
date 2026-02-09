'use client';

/**
 * useCloakAddress — Resolves cloak slug/address to a valid address
 *
 * Resolution order:
 * 1. Check if input is already a valid Aztec address
 * 2. Check local Zustand store (in-memory cache)
 * 3. Query CloakRegistry contract (on-chain source of truth)
 *
 * Uses a lightweight registry lookup that doesn't require the full wallet client.
 */

import { useState, useEffect, useMemo } from 'react';
import { useAztecStore } from '@/store/aztecStore';
import { nameToSlug } from '@/lib/utils/slug';

export interface UseCloakAddressResult {
  /** The resolved cloak address (or null if not found) */
  address: string | null;
  /** Cloak metadata from store (if available) */
  cloak: any | null;
  /** Whether we're currently resolving the address */
  isResolving: boolean;
  /** Whether we've finished all resolution attempts */
  isResolved: boolean;
  /** Error message if resolution failed */
  error: string | null;
}

export function useCloakAddress(cloakIdOrSlug: string): UseCloakAddressResult {
  const addCloak = useAztecStore((s: any) => s.addCloak);

  // Check local store first - try multiple matching strategies
  const cloakBySlug = useAztecStore((s: any) =>
    s.cloakList.find((d: any) => d.slug === cloakIdOrSlug)
  );
  const cloakBySlugLower = useAztecStore((s: any) =>
    s.cloakList.find((d: any) => d.slug?.toLowerCase() === cloakIdOrSlug?.toLowerCase())
  );
  const cloakByName = useAztecStore((s: any) =>
    s.cloakList.find((d: any) => d.name?.toLowerCase() === cloakIdOrSlug?.toLowerCase())
  );
  const cloakByNameSlug = useAztecStore((s: any) =>
    s.cloakList.find((d: any) => nameToSlug(d.name || '') === cloakIdOrSlug?.toLowerCase())
  );
  const cloakByAddress = useAztecStore((s: any) =>
    s.cloakList.find((d: any) => d.address === cloakIdOrSlug)
  );
  const cloak = cloakBySlug || cloakBySlugLower || cloakByName || cloakByNameSlug || cloakByAddress;

  // Debug: log store contents
  const cloakListLength = useAztecStore((s: any) => s.cloakList?.length ?? 0);

  // Check if input is already a valid address
  const isValidAddress = useMemo(
    () => cloakIdOrSlug?.startsWith('0x') && cloakIdOrSlug.length > 40,
    [cloakIdOrSlug]
  );

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isResolved, setIsResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the cloak address
  useEffect(() => {
    let mounted = true;

    async function resolveCloak() {
      console.log('[useCloakAddress] Resolving:', cloakIdOrSlug, {
        foundInStore: !!cloak,
        storeAddress: cloak?.address,
        storeSlug: cloak?.slug,
        storeName: cloak?.name,
        cloakListLength,
        isValidAddress,
      });

      // Case 1: Already have it from store
      if (cloak?.address) {
        console.log('[useCloakAddress] Found in store:', cloak.address);
        if (mounted) {
          setIsResolved(true);
        }
        return;
      }

      // Case 2: Input is already a valid address
      if (isValidAddress) {
        console.log('[useCloakAddress] Input is valid address:', cloakIdOrSlug);
        if (mounted) {
          setResolvedAddress(cloakIdOrSlug);
          setIsResolved(true);
        }
        return;
      }

      // Case 3: Look up in CloakRegistry (on-chain)
      if (mounted) {
        setIsResolving(true);
        setError(null);
      }

      try {
        console.log('[useCloakAddress] Querying CloakRegistry for:', cloakIdOrSlug);

        // Use the lightweight registry lookup (doesn't need full wallet)
        const { lookupCloakByName } = await import('@/lib/aztec/registryLookup');
        const addrStr = await lookupCloakByName(cloakIdOrSlug);

        console.log('[useCloakAddress] Registry result:', addrStr);

        if (!mounted) return;

        if (addrStr) {
          setResolvedAddress(addrStr);

          // Add to store for caching during this session
          addCloak({
            address: addrStr,
            name: cloakIdOrSlug,
            slug: nameToSlug(cloakIdOrSlug),
            memberCount: 0,
            proposalCount: 0,
            templateId: 1, // Assume Governor Bravo
          });
        } else {
          setError(`Cloak "${cloakIdOrSlug}" not found in registry`);
        }
      } catch (err) {
        console.warn('[useCloakAddress] Failed to resolve from registry:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to resolve cloak');
        }
      } finally {
        if (mounted) {
          setIsResolving(false);
          setIsResolved(true);
        }
      }
    }

    resolveCloak();

    return () => {
      mounted = false;
    };
  }, [cloakIdOrSlug, cloak?.address, isValidAddress, cloakListLength, addCloak]);

  // Determine final address
  const address = cloak?.address || resolvedAddress || (isValidAddress ? cloakIdOrSlug : null);

  // Log final resolution result for debugging
  useEffect(() => {
    if (isResolved && !isResolving) {
      console.log('[useCloakAddress] Resolution complete:', {
        input: cloakIdOrSlug,
        resolvedAddress: address,
        fromStore: !!cloak,
        templateId: cloak?.templateId,
      });
    }
  }, [isResolved, isResolving, cloakIdOrSlug, address, cloak]);

  return {
    address,
    cloak,
    isResolving,
    isResolved,
    error,
  };
}
