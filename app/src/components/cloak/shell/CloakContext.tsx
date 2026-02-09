'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { TemplateId } from '@/lib/templates/TemplateFactory';
import type { PrivacyLevel } from '@/lib/constants/templates';
import { useAztecStore } from '@/store/aztecStore';
import { useWalletContext } from '@/components/wallet/WalletProvider';

export interface CloakContextState {
  address: string;
  slug: string;  // URL-safe identifier (derived from name)
  name: string;
  templateId: TemplateId;
  privacyLevel: PrivacyLevel;
  memberCount: number;
  proposalCount: number;
  isAdmin: boolean;
  isMember: boolean;
  isLoading: boolean;
  error: string | null;
}

interface CloakContextValue extends CloakContextState {
  refresh: () => Promise<void>;
  navigatingTo: string | null;
  setNavigatingTo: (tab: string | null) => void;
}

const CloakContext = createContext<CloakContextValue | null>(null);

interface CloakProviderProps {
  address: string;
  children: ReactNode;
}

export function CloakProvider({ address, children }: CloakProviderProps) {
  // Look up cloak from the persisted store (by slug or address)
  const storeCloak = useAztecStore((s) =>
    s.cloakList.find((d) => d.slug === address || d.address === address)
  );
  const { account } = useWalletContext();

  const [state, setState] = useState<CloakContextState>({
    address: storeCloak?.address ?? address,
    slug: storeCloak?.slug ?? address,  // Fall back to address if no slug
    name: storeCloak?.name ?? '',
    templateId: (storeCloak?.templateId ?? 1) as TemplateId,
    privacyLevel: (storeCloak?.privacyLevel ?? 'balanced') as PrivacyLevel,
    memberCount: storeCloak?.memberCount ?? 0,
    proposalCount: storeCloak?.proposalCount ?? 0,
    isAdmin: false,
    isMember: false,
    isLoading: true,
    error: null,
  });

  const fetchCloakInfo = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // Use store data — on-chain reads happen in CloakDashboard for supported templates
      setState((prev) => ({
        ...prev,
        address: storeCloak?.address ?? address,
        slug: storeCloak?.slug ?? prev.slug,
        name: storeCloak?.name ?? (prev.name || address.slice(0, 10) + '...'),
        templateId: (storeCloak?.templateId ?? prev.templateId) as TemplateId,
        privacyLevel: (storeCloak?.privacyLevel ?? prev.privacyLevel) as PrivacyLevel,
        memberCount: storeCloak?.memberCount ?? prev.memberCount,
        proposalCount: storeCloak?.proposalCount ?? prev.proposalCount,
        isAdmin: !!(storeCloak?.role && storeCloak.role >= 2),
        isMember: true,
        isLoading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load Cloak',
      }));
    }
  };

  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  useEffect(() => {
    fetchCloakInfo();
  }, [address]);

  const value: CloakContextValue = {
    ...state,
    refresh: fetchCloakInfo,
    navigatingTo,
    setNavigatingTo,
  };

  return <CloakContext.Provider value={value}>{children}</CloakContext.Provider>;
}

export function useCloakContext(): CloakContextValue {
  const context = useContext(CloakContext);
  if (!context) {
    throw new Error('useCloakContext must be used within a CloakProvider');
  }
  return context;
}
