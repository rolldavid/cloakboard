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
  role?: number;                 // 0=none, 1=member, 2=admin, 3=creator
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

  // Registry and Memberships contracts
  registryAddress: string | null;
  connectionsAddress: string | null;  // Deprecated - kept for compatibility
  membershipsAddress: string | null;  // Public membership registry

  // Cloak state
  currentCloak: CloakInfo | null;
  cloakList: CloakInfo[];

  // Starred cloaks (cached from on-chain private notes)
  starredAddresses: string[];

  // Pending registry registrations (deferred until account deployment + note sync)
  pendingRegistrations: { name: string; cloakAddress: string }[];

  // Pending membership recordings (deferred until signing key note is available)
  pendingMemberships: { userAddress: string; cloakAddress: string; role: number }[];

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
  setConnectionsAddress: (address: string) => void;
  setMembershipsAddress: (address: string) => void;
  setCurrentCloak: (cloak: CloakInfo | null) => void;
  addCloak: (cloak: CloakInfo) => void;
  removeCloak: (address: string) => void;
  clearAll: () => void;
  clearUserData: () => void;  // Clears session data (cloakList, starred) without clearing account keys
  // Lookup helpers
  isSlugTaken: (slug: string) => boolean;
  getCloakBySlug: (slug: string) => CloakInfo | undefined;
  // Pending registrations actions
  addPendingRegistration: (reg: { name: string; cloakAddress: string }) => void;
  clearPendingRegistrations: () => void;
  getPendingRegistrations: () => { name: string; cloakAddress: string }[];
  // Pending memberships actions
  addPendingMembership: (mem: { userAddress: string; cloakAddress: string; role: number }) => void;
  clearPendingMemberships: () => void;
  removePendingMembership: (cloakAddress: string) => void;
  getPendingMemberships: () => { userAddress: string; cloakAddress: string; role: number }[];
  // Starred cloaks actions
  setStarredAddresses: (addresses: string[]) => void;
  addStarredAddress: (address: string) => void;
  removeStarredAddress: (address: string) => void;
  isStarred: (address: string) => boolean;
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
      connectionsAddress: null,
      membershipsAddress: null,
      currentCloak: null,
      cloakList: [],
      starredAddresses: [],
      pendingRegistrations: [],
      pendingMemberships: [],

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
      setConnectionsAddress: (address) => set({ connectionsAddress: address }),
      setMembershipsAddress: (address) => set({ membershipsAddress: address }),
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
          // NOTE: registryAddress, connectionsAddress, membershipsAddress are
          // infrastructure addresses set from network config. They must NOT be
          // cleared on logout — they're the same for all users on the same network.
          currentCloak: null,
          cloakList: [],
          starredAddresses: [],
          pendingRegistrations: [],
          pendingMemberships: [],
        }),

      clearUserData: () =>
        set({
          currentCloak: null,
          cloakList: [],
          starredAddresses: [],
          pendingRegistrations: [],
          pendingMemberships: [],
        }),

      isSlugTaken: (slug: string) => {
        return get().cloakList.some((d) => d.slug === slug);
      },

      getCloakBySlug: (slug: string) => {
        return get().cloakList.find((d) => d.slug === slug);
      },

      // Pending registrations actions
      addPendingRegistration: (reg: { name: string; cloakAddress: string }) =>
        set((state) => ({
          pendingRegistrations: [...state.pendingRegistrations, reg],
        })),

      clearPendingRegistrations: () => set({ pendingRegistrations: [] }),

      getPendingRegistrations: () => get().pendingRegistrations,

      // Pending memberships actions
      addPendingMembership: (mem: { userAddress: string; cloakAddress: string; role: number }) =>
        set((state) => ({
          pendingMemberships: [...state.pendingMemberships, mem],
        })),

      clearPendingMemberships: () => set({ pendingMemberships: [] }),

      removePendingMembership: (cloakAddress: string) =>
        set((state) => ({
          pendingMemberships: state.pendingMemberships.filter((m) => m.cloakAddress !== cloakAddress),
        })),

      getPendingMemberships: () => get().pendingMemberships,

      // Starred cloaks actions
      setStarredAddresses: (addresses: string[]) => set({ starredAddresses: addresses }),

      addStarredAddress: (address: string) =>
        set((state) => ({
          starredAddresses: state.starredAddresses.includes(address)
            ? state.starredAddresses
            : [...state.starredAddresses, address],
        })),

      removeStarredAddress: (address: string) =>
        set((state) => ({
          starredAddresses: state.starredAddresses.filter((a) => a !== address),
        })),

      isStarred: (address: string) => {
        return get().starredAddresses.includes(address);
      },
    }),
    {
      name: 'aztec-storage',
      partialize: (state) => ({
        account: state.account,
        registryAddress: state.registryAddress,
        connectionsAddress: state.connectionsAddress,
        membershipsAddress: state.membershipsAddress,
        // cloakList is NOT persisted - resolved from CloakMemberships + CloakRegistry on demand
        secretKey: state.secretKey,
        signingKey: state.signingKey,
        salt: state.salt,
        pendingRegistrations: state.pendingRegistrations,
        pendingMemberships: state.pendingMemberships,
        // starredAddresses is NOT persisted - fetched from private notes on login
      }),
    }
  )
);
