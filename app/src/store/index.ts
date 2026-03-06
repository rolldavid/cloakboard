import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthMethod } from '@/types/wallet';
import { clearAuthToken } from '@/lib/api/authToken';
import { setVoteTrackerUser } from '@/lib/voteTracker';
import { resetPointsTracker, getOptimisticPoints, onPointsAdded, onPointsSynced } from '@/lib/pointsTracker';

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

  // Points (reactive — backed by localStorage via pointsTracker)
  whisperPoints: number;

  // Wallet setup status (visible on mobile deploy banner)
  walletStatus: string | null;

  // Actions
  setUserAddress: (address: string | null) => void;
  setUserName: (name: string | null) => void;
  setAuthenticated: (auth: boolean) => void;
  setDeployed: (deployed: boolean) => void;
  setAuthMethod: (method: AuthMethod | null) => void;
  setAuthSeed: (seed: string | null) => void;
  addWhisperPoints: (amount: number) => void;
  setWalletStatus: (status: string | null) => void;
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
      whisperPoints: getOptimisticPoints(),
      walletStatus: null,

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
        if (seed) {
          try { sessionStorage.setItem('duelcloak-authSeed', seed); } catch { /* quota */ }
        } else {
          try { sessionStorage.removeItem('duelcloak-authSeed'); } catch { /* ignore */ }
        }
      },
      addWhisperPoints: (amount) => set((s) => ({ whisperPoints: s.whisperPoints + amount })),
      setWalletStatus: (status) => set({ walletStatus: status }),
      reset: () => {
        clearAuthToken();
        setVoteTrackerUser(null);
        resetPointsTracker();
        try { sessionStorage.removeItem('duelcloak-authSeed'); } catch { /* ignore */ }
        try { localStorage.removeItem('duelcloak-googleSalt'); } catch { /* ignore */ }
        set({
          userAddress: null,
          userName: null,
          isAuthenticated: false,
          isDeployed: false,
          authMethod: null,
          authSeed: null,
          whisperPoints: 0,
          walletStatus: null,
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
      }),
      onRehydrateStorage: () => (state) => {
        // Sync voteTracker with restored user address on page load
        if (state?.userAddress) setVoteTrackerUser(state.userAddress);
        // Initialize whisperPoints from localStorage (pointsTracker is source of truth)
        if (state) state.whisperPoints = getOptimisticPoints();
      },
    },
  ),
);

// Wire up pointsTracker → store reactivity (avoids circular dep)
onPointsAdded((amount) => useAppStore.getState().addWhisperPoints(amount));
onPointsSynced((total) => useAppStore.setState({ whisperPoints: total }));
