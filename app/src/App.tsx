import { Routes, Route, Navigate, Link, useLocation, useOutlet } from 'react-router-dom';
import { useThemeStore, useAppStore } from './store/index';
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthMethodSelector } from './components/auth/AuthMethodSelector';
import { GoogleCallback } from './pages/GoogleCallback';
import { ConnectButton } from './components/wallet/ConnectButton';
import { FeedPage } from './pages/FeedPage';
import { CloakFeedPage } from './pages/CloakFeedPage';
import { DuelDetailPage } from './pages/DuelDetailPage';
import { ExplorePage } from './pages/ExplorePage';
import { UserProfilePage } from './pages/UserProfilePage';
import { CreateCloakPage } from './pages/CreateCloakPage';
import { getAztecClient } from './lib/aztec/client';
import { restoreWalletSession } from './lib/wallet/restoreWalletSession';

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
    if (client?.hasWallet()) return; // Already initialized

    // HIGH-2: Try sessionStorage if authSeed is not in memory (e.g., page refresh)
    let seed = authSeed;
    if (!seed) {
      try { seed = sessionStorage.getItem('duelcloak-authSeed'); } catch { /* ignore */ }
      if (seed) {
        setAuthSeed(seed);
      }
    }

    if (!seed) {
      // No seed in memory or sessionStorage — can't restore. Force re-login.
      reset();
      return;
    }

    restoredRef.current = true;
    restoreWalletSession(authMethod, seed);
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-bold text-foreground hover:text-accent transition-colors">
            DuelCloak
          </Link>
          <span className="text-xs text-foreground-muted hidden sm:inline">Privacy-preserving duels</span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated && (
            <Link
              to="/create"
              className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Create</span>
            </Link>
          )}
          <Link
            to="/explore"
            className="px-3 py-1.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
          >
            Explore
          </Link>
          <ConnectButton />
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <AnimatedOutlet />
      </main>
    </div>
  );
}

function LoginPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Welcome to DuelCloak</h2>
        <p className="text-foreground-secondary">
          Sign in to participate in private opinion duels
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
          <Route path="/" element={<FeedPage />} />
          <Route path="/c/:cloakSlug" element={<CloakFeedPage />} />
          <Route path="/d/:cloakSlug/:duelId" element={<DuelDetailPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route
            path="/create"
            element={
              <ProtectedRoute>
                <CreateCloakPage />
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
