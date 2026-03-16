import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/index';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleAuthService } from '@/lib/auth/google/GoogleAuthService';
import { EthereumAuthService } from '@/lib/auth/ethereum/EthereumAuthService';
import { SolanaAuthService } from '@/lib/auth/solana/SolanaAuthService';
import { PasskeyAuthService } from '@/lib/auth/passkey/PasskeyAuthService';
import { AztecClient } from '@/lib/aztec/client';
import { resetPxeWarmup } from '@/lib/aztec/pxeWarmup';
import { resetWalletCreation } from '@/lib/wallet/backgroundWalletService';
import { resetDuelServiceCache } from '@/hooks/useDuelService';

export function ConnectButton() {
  const { isAuthenticated, userName, userAddress, whisperPoints, pointsLoading, reset } = useAppStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Pulse animation when points change (must be before early return)
  const [pulse, setPulse] = useState(false);
  const prevPointsRef = useRef(whisperPoints);
  useEffect(() => {
    if (whisperPoints > prevPointsRef.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(t);
    }
    prevPointsRef.current = whisperPoints;
  }, [whisperPoints]);

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
    resetPxeWarmup(); // Clear PXE singleton so next login gets fresh wallet without old account keys
    resetWalletCreation();
    resetDuelServiceCache(); // Clear cached DuelCloakService instances bound to old wallet
    reset();
    setOpen(false);
    navigate('/', { replace: true });
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
    <div ref={ref} className="relative flex items-center gap-2">
      {/* Points badge — always visible in header */}
      <Link
          to="/positions"
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold tabular-nums transition-all ${
            pulse
              ? 'bg-accent/20 text-accent scale-110'
              : 'bg-accent/10 text-accent/80 hover:bg-accent/15'
          }`}
          style={{ transition: 'all 0.3s ease' }}
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          {pointsLoading ? (
            <span className="inline-block w-6 h-3 bg-accent/20 rounded animate-pulse" />
          ) : whisperPoints}
        </Link>
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
            {/* Positions link */}
            <Link
              to="/positions"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-3 bg-accent/5 hover:bg-accent/10 transition-colors"
            >
              <svg className="w-4 h-4 text-accent shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l1.4 2.8 3.1.5-2.3 2.2.5 3.1L12 8.9l-2.7 1.7.5-3.1L7.5 5.3l3.1-.5z" />
                <path d="M12 8l1.4 2.8 3.1.5-2.3 2.2.5 3.1L12 14.9l-2.7 1.7.5-3.1-2.3-2.2 3.1-.5z" opacity=".6" />
                <path d="M12 14l1.4 2.8 3.1.5-2.3 2.2.5 3.1L12 20.9l-2.7 1.7.5-3.1-2.3-2.2 3.1-.5z" opacity=".3" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-accent">Positions</div>
              </div>
            </Link>

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
