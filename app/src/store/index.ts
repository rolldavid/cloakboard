import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthMethod } from '@/types/wallet';
import { clearAuthToken } from '@/lib/api/authToken';
import { setVoteTrackerUser } from '@/lib/voteTracker';
import { resetPointsTracker } from '@/lib/pointsTracker';

// --- Theme Store ---

interface ThemeState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'duelcloak-theme' },
  ),
);

// --- App Store ---

interface AppState {
  // Auth
  userAddress: string | null;
  userName: string | null;
  isAuthenticated: boolean;
  isDeployed: boolean;
  authMethod: AuthMethod | null;
  authSeed: string | null;

  // Cloak
  cloakAddress: string | null;

  // Actions
  setUserAddress: (address: string | null) => void;
  setUserName: (name: string | null) => void;
  setAuthenticated: (auth: boolean) => void;
  setDeployed: (deployed: boolean) => void;
  setAuthMethod: (method: AuthMethod | null) => void;
  setAuthSeed: (seed: string | null) => void;
  setCloakAddress: (address: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userAddress: null,
      userName: null,
      isAuthenticated: false,
      isDeployed: false,
      authMethod: null,
      authSeed: null,
      cloakAddress: null,

      setUserAddress: (address) => {
        setVoteTrackerUser(address);
        set({ userAddress: address });
      },
      setUserName: (name) => set({ userName: name }),
      setAuthenticated: (auth) => set({ isAuthenticated: auth }),
      setDeployed: (deployed) => set({ isDeployed: deployed }),
      setAuthMethod: (method) => set({ authMethod: method }),
      setAuthSeed: (seed) => {
        set({ authSeed: seed });
        // HIGH-2: Store authSeed in sessionStorage (cleared on tab close) instead of localStorage
        if (seed) {
          try { sessionStorage.setItem('duelcloak-authSeed', seed); } catch { /* quota */ }
        } else {
          try { sessionStorage.removeItem('duelcloak-authSeed'); } catch { /* ignore */ }
        }
      },
      setCloakAddress: (address) => set({ cloakAddress: address }),
      reset: () => {
        clearAuthToken();
        setVoteTrackerUser(null);
        resetPointsTracker();
        try { sessionStorage.removeItem('duelcloak-authSeed'); } catch { /* ignore */ }
        set({
          userAddress: null,
          userName: null,
          isAuthenticated: false,
          isDeployed: false,
          authMethod: null,
          authSeed: null,
          // Keep cloakAddress -- it's infrastructure-level
        });
      },
    }),
    {
      name: 'duelcloak-app',
      partialize: (state) => ({
        userAddress: state.userAddress,
        userName: state.userName,
        isAuthenticated: state.isAuthenticated,
        isDeployed: state.isDeployed,
        authMethod: state.authMethod,
        // HIGH-2: authSeed is NOT persisted to localStorage — kept in memory only
        // (or sessionStorage via setAuthSeed). Re-derived from auth provider on each session.
        cloakAddress: state.cloakAddress,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync voteTracker with restored user address on page load
        if (state?.userAddress) setVoteTrackerUser(state.userAddress);
      },
    },
  ),
);
