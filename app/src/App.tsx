import { Routes, Route, Navigate, Link, useLocation, useOutlet } from 'react-router-dom';
import { useThemeStore, useAppStore } from './store/index';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthMethodSelector } from './components/auth/AuthMethodSelector';
import { GoogleCallback } from './pages/GoogleCallback';
import { ConnectButton } from './components/wallet/ConnectButton';
import { CloakLogo } from './components/ui/CloakLogo';
import { CloakOwl } from './components/ui/CloakOwl';
import { HomePage } from './pages/HomePage';
import { CategoryPage } from './pages/CategoryPage';
import { DuelDetailPage } from './pages/DuelDetailPage';
import { CreateDuelPage } from './pages/CreateDuelPage';
import { SearchResultsPage } from './pages/SearchResultsPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { BreakingPage } from './pages/BreakingPage';
import { SearchBar, MobileSearchIcon, MobileSearchBar } from './components/nav/SearchBar';
import { getAztecClient } from './lib/aztec/client';
import { restoreWalletSession } from './lib/wallet/restoreWalletSession';
import { generateUsername } from './lib/username/generator';
import { getAuthToken, authenticateWithServer } from './lib/api/authToken';

function ThemeInitializer() {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return null;
}

function WalletInitializer() {
  const { isAuthenticated, authMethod, authSeed, setAuthSeed, reset } = useAppStore();
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !authMethod) return;
    if (restoredRef.current) return;

    const client = getAztecClient();
    if (client?.hasWallet()) return;

    let seed = authSeed;
    if (!seed) {
      try { seed = localStorage.getItem('duelcloak-authSeed'); } catch { /* ignore */ }
      // Migration: check sessionStorage for users who logged in before this change
      if (!seed) {
        try { seed = sessionStorage.getItem('duelcloak-authSeed'); } catch { /* ignore */ }
      }
      if (seed) {
        setAuthSeed(seed);
      }
    }

    if (!seed) {
      reset();
      return;
    }

    restoredRef.current = true;
    const restored = restoreWalletSession(authMethod, seed);
    if (!restored) {
      // Salt missing (e.g. Google without localStorage salt) — force re-login
      restoredRef.current = false;
      reset();
      return;
    }

    // Regenerate username from current seed+salt to fix stale cached usernames
    const salt = authMethod === 'google' ? localStorage.getItem('duelcloak-googleSalt') : null;
    const usernameSeed = salt ? seed + ':' + salt : seed;
    const correctUsername = generateUsername(usernameSeed);
    const { userName, userAddress } = useAppStore.getState();
    if (userName !== correctUsername) {
      useAppStore.setState({ userName: correctUsername });
    }

    // Re-authenticate with server if JWT is missing (Safari private browsing, storage cleared, etc.)
    const finalName = userName !== correctUsername ? correctUsername : userName;
    if (userAddress && finalName && !getAuthToken()) {
      authenticateWithServer(userAddress, finalName).catch(() => {
        console.warn('[WalletInitializer] Re-authentication failed');
      });
    }
  }, [isAuthenticated, authMethod, authSeed, setAuthSeed, reset]);

  return null;
}

function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.15, ease: 'easeInOut' }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

function Layout() {
  const { isAuthenticated } = useAppStore();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            <CloakLogo size="md" />
          </Link>
        </div>

        <div className="flex-1 ml-4">
          <SearchBar />
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <MobileSearchIcon onClick={() => setMobileSearchOpen(true)} />
          <Link
            to="/create"
            className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Create</span>
          </Link>
          <ConnectButton />
        </div>
      </header>
      {mobileSearchOpen && <MobileSearchBar onClose={() => setMobileSearchOpen(false)} />}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <AnimatedOutlet />
      </main>
    </div>
  );
}

function LoginPage() {
  const { isAuthenticated } = useAppStore();

  // Redirect authenticated users to their intended page or home
  if (isAuthenticated) {
    let returnTo = '/';
    try {
      const stored = sessionStorage.getItem('returnTo');
      if (stored) {
        returnTo = stored;
        sessionStorage.removeItem('returnTo');
      }
    } catch { /* ignore */ }
    return <Navigate to={returnTo} replace />;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center space-y-3">
        <CloakOwl size="lg" className="mx-auto" />
        <h2 className="text-2xl font-bold text-foreground">Welcome to Cloakboard</h2>
        <p className="text-foreground-secondary text-sm max-w-sm mx-auto">
          Cloakboard accounts are 100% private - nobody other than you sees how you logged in, including the app itself.
        </p>
      </div>
      <div className="w-full max-w-md">
        <AuthMethodSelector />
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAppStore();
  const location = useLocation();
  if (!isAuthenticated) {
    sessionStorage.setItem('returnTo', location.pathname + location.search);
    return <Navigate to="/login" />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <ThemeInitializer />
      <WalletInitializer />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/onboarding/google" element={<GoogleCallback />} />
          <Route path="/" element={<HomePage />} />
          <Route path="/breaking" element={<BreakingPage />} />
          <Route path="/c/:categorySlug" element={<CategoryPage />} />
          <Route path="/c/:categorySlug/:subSlug" element={<CategoryPage />} />
          <Route path="/d/:duelSlug/:periodSlug?" element={<DuelDetailPage />} />
          <Route path="/search" element={<SearchResultsPage />} />
          <Route
            path="/create"
            element={
              <ProtectedRoute>
                <CreateDuelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/u/:username"
            element={
              <ProtectedRoute>
                <UserProfilePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
