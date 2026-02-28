import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore, useThemeStore } from '@/store/index';
import { Link } from 'react-router-dom';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { EthereumAuthService } from '@/lib/auth/ethereum/EthereumAuthService';
import { SolanaAuthService } from '@/lib/auth/solana/SolanaAuthService';
import { PasskeyAuthService } from '@/lib/auth/passkey/PasskeyAuthService';
import { AztecClient } from '@/lib/aztec/client';
import { resetWalletCreation } from '@/lib/wallet/backgroundWalletService';

export function ConnectButton() {
  const { isAuthenticated, userName, userAddress, reset } = useAppStore();
  const { theme, toggleTheme } = useThemeStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = () => {
    GoogleAuthService.clearStoredOAuthData();
    EthereumAuthService.clearSession();
    SolanaAuthService.clearSession();
    PasskeyAuthService.clearSession();
    AztecClient.resetInstance();
    resetWalletCreation();
    reset();
    setOpen(false);
  };

  if (!isAuthenticated) {
    return (
      <Link
        to="/login"
        className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
      >
        Login
      </Link>
    );
  }

  const displayName = userName || (userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-4)}` : 'User');

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground hover:text-accent transition-colors"
      >
        <span>{displayName}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-md shadow-lg z-50 overflow-hidden"
          >
            {/* Theme toggle */}
            <button
              onClick={() => { toggleTheme(); }}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-card-hover transition-colors"
            >
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              <span className="text-foreground-muted text-xs">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>

            <div className="border-t border-border" />

            {/* Profile link */}
            {userName && (
              <Link
                to={`/u/${userName}`}
                onClick={() => setOpen(false)}
                className="w-full flex items-center px-4 py-2.5 text-sm text-foreground hover:bg-card-hover transition-colors"
              >
                Profile
              </Link>
            )}

            <div className="border-t border-border" />

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center px-4 py-2.5 text-sm text-status-error hover:bg-card-hover transition-colors"
            >
              Logout
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
