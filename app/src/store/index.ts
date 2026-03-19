import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthMethod } from '@/types/wallet';
import { clearAuthToken } from '@/lib/api/authToken';
import { setVoteTrackerUser } from '@/lib/voteTracker';
import { setNotificationUser } from '@/lib/notifications/localNotifications';
import {
  resetPointsTracker, getOptimisticPoints, setActiveAccount, isInitialGrantSent,
  onPointsAdded, onPointsSynced,
} from '@/lib/pointsTracker';
import { encryptAndStore, removeSeedData, clearSessionKey } from '@/lib/wallet/seedVault';

// --- Theme Store ---

interface ThemeState {
  theme: 'light' | 'dark' | 'system';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      toggleTheme: () =>
        set((s) => {
          const current = resolveTheme(s.theme);
          return { theme: current === 'dark' ? 'light' : 'dark' };
        }),
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

  // Wallet setup status (visible on deploy banner)
  walletStatus: string | null;

  // Points grant (500pt initial grant confirmed on-chain)
  pointsGranted: boolean;

  // Points loading (true until on-chain refresh completes)
  pointsLoading: boolean;

  // Welcome modal
  showWelcomeModal: boolean;

  // Actions
  setUserAddress: (address: string | null) => void;
  setUserName: (name: string | null) => void;
  setAuthenticated: (auth: boolean) => void;
  setDeployed: (deployed: boolean) => void;
  setAuthMethod: (method: AuthMethod | null) => void;
  setAuthSeed: (seed: string | null) => void;
  addWhisperPoints: (amount: number) => void;
  setWalletStatus: (status: string | null) => void;
  setPointsGranted: (granted: boolean) => void;
  setPointsLoading: (loading: boolean) => void;
  setShowWelcomeModal: (show: boolean) => void;
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
      whisperPoints: 0,
      walletStatus: null,
      pointsGranted: false,
      pointsLoading: true,
      showWelcomeModal: false,

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
          encryptAndStore('duelcloak-authSeed', seed).catch(() => {});
        } else {
          removeSeedData('duelcloak-authSeed');
        }
      },
      addWhisperPoints: (amount) => set((s) => ({ whisperPoints: s.whisperPoints + amount })),
      setWalletStatus: (status) => set({ walletStatus: status }),
      setPointsGranted: (granted) => set({ pointsGranted: granted }),
      setPointsLoading: (loading) => set({ pointsLoading: loading }),
      setShowWelcomeModal: (show) => set({ showWelcomeModal: show }),
      reset: () => {
        clearAuthToken();
        setVoteTrackerUser(null);
        setNotificationUser(null);
        resetPointsTracker();
        removeSeedData('duelcloak-authSeed');
        removeSeedData('duelcloak-googleSalt');
        clearSessionKey();
        set({
          userAddress: null,
          userName: null,
          isAuthenticated: false,
          isDeployed: false,
          authMethod: null,
          authSeed: null,
          whisperPoints: 0,
          walletStatus: null,
          pointsGranted: false,
          pointsLoading: true,
          showWelcomeModal: false,
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
        if (!state) return;
        // Sync voteTracker with restored user address on page load
        if (state.userAddress) setVoteTrackerUser(state.userAddress);
        if (state.userAddress) setNotificationUser(state.userAddress);
        // Set active account for pointsTracker → loads this account's cached balance
        if (state.userAddress) setActiveAccount(state.userAddress);
        state.whisperPoints = getOptimisticPoints();
        state.pointsGranted = isInitialGrantSent();
        // If we have cached points, no need to show loading skeleton — on-chain
        // refresh will correct the value in background. This prevents gray vote
        // buttons during the 5-10s wallet init window on page refresh.
        if (state.whisperPoints > 0) state.pointsLoading = false;
      },
    },
  ),
);

// Wire up pointsTracker → store reactivity (avoids circular dep)
onPointsAdded((amount) => useAppStore.getState().addWhisperPoints(amount));
onPointsSynced((total) => useAppStore.setState({ whisperPoints: total }));
