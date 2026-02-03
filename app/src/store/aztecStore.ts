import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AccountInfo {
  address: string;
  publicKey: string;
  isDeployed: boolean;
}

interface CloakInfo {
  address: string;
  name: string;
  memberCount: number;
  proposalCount: number;
  ownerAddress?: string;         // Aztec account address of the creator
  templateId?: number;
  privacyLevel?: 'maximum' | 'balanced' | 'transparent';
  lastActivityAt?: number;
  pendingActions?: number;
  membershipMode?: 'invite' | 'domain' | 'aztec-token' | 'erc20-token';
  tokenAddress?: string;
  tokenGateAddress?: string;
  erc20TokenAddress?: string;
  erc20ChainId?: number;
  minimumBalance?: string;
  cloakMode?: number;  // 0 = token-holder, 1 = multisig, 2 = hybrid
  councilMembers?: string[];
  councilThreshold?: number;
  emergencyThreshold?: number;
  slug?: string;                // URL-safe unique name (derived from Cloak name)
  isPubliclySearchable?: boolean;  // appears in explore page
  isPubliclyViewable?: boolean;    // anyone can view at /cloak/[slug]
}

interface AztecState {
  // Connection state
  isInitialized: boolean;
  isConnecting: boolean;
  error: string | null;

  // Account state
  account: AccountInfo | null;
  secretKey: string | null;
  signingKey: string | null;
  salt: string | null;

  // Registry
  registryAddress: string | null;

  // Cloak state
  currentCloak: CloakInfo | null;
  cloakList: CloakInfo[];

  // Actions
  setInitialized: (initialized: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setAccount: (account: AccountInfo | null) => void;
  setSecretKey: (secretKey: string | null) => void;
  setSigningKey: (signingKey: string | null) => void;
  setSalt: (salt: string | null) => void;
  setAccountKeys: (keys: { secretKey: string; signingKey: string; salt: string } | null) => void;
  getAccountKeys: () => { secretKey: string; signingKey: string; salt: string } | null;
  setRegistryAddress: (address: string) => void;
  setCurrentCloak: (cloak: CloakInfo | null) => void;
  addCloak: (cloak: CloakInfo) => void;
  removeCloak: (address: string) => void;
  clearAll: () => void;
  // Lookup helpers
  isSlugTaken: (slug: string) => boolean;
  getCloakBySlug: (slug: string) => CloakInfo | undefined;
}

export const useAztecStore = create<AztecState>()(
  persist(
    (set, get) => ({
      // Initial state
      isInitialized: false,
      isConnecting: false,
      error: null,
      account: null,
      secretKey: null,
      signingKey: null,
      salt: null,
      registryAddress: null,
      currentCloak: null,
      cloakList: [],

      // Actions
      setInitialized: (initialized) => set({ isInitialized: initialized }),
      setConnecting: (connecting) => set({ isConnecting: connecting }),
      setError: (error) => set({ error }),

      setAccount: (account) => set({ account }),
      setSecretKey: (secretKey) => set({ secretKey }),
      setSigningKey: (signingKey) => set({ signingKey }),
      setSalt: (salt) => set({ salt }),
      setAccountKeys: (keys) => set(keys ? { secretKey: keys.secretKey, signingKey: keys.signingKey, salt: keys.salt } : { secretKey: null, signingKey: null, salt: null }),
      getAccountKeys: () => {
        const { secretKey, signingKey, salt } = get();
        if (secretKey && signingKey && salt) return { secretKey, signingKey, salt };
        return null;
      },

      setRegistryAddress: (address) => set({ registryAddress: address }),
      setCurrentCloak: (cloak) => set({ currentCloak: cloak }),

      addCloak: (cloak) =>
        set((state) => ({
          cloakList: state.cloakList.some((d) => d.address === cloak.address)
            ? state.cloakList.map((d: any) => (d.address === cloak.address ? cloak : d))
            : [...state.cloakList, cloak],
        })),

      removeCloak: (address) =>
        set((state) => ({
          cloakList: state.cloakList.filter((d: any) => d.address !== address),
          currentCloak: state.currentCloak?.address === address ? null : state.currentCloak,
        })),

      clearAll: () =>
        set({
          isInitialized: false,
          isConnecting: false,
          error: null,
          account: null,
          secretKey: null,
          signingKey: null,
          salt: null,
          registryAddress: null,
          currentCloak: null,
          cloakList: [],
        }),

      isSlugTaken: (slug: string) => {
        return get().cloakList.some((d) => d.slug === slug);
      },

      getCloakBySlug: (slug: string) => {
        return get().cloakList.find((d) => d.slug === slug);
      },
    }),
    {
      name: 'aztec-storage',
      partialize: (state) => ({
        account: state.account,
        registryAddress: state.registryAddress,
        cloakList: state.cloakList,
        secretKey: state.secretKey,
        signingKey: state.signingKey,
        salt: state.salt,
      }),
    }
  )
);
