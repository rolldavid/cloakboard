/**
 * Duel Creation Modal -- overlay shown during duel creation.
 *
 * Phases:
 * 1. "Creating" -- DB insert in progress
 * 2. "Setting up" -- polling until on_chain_id is set (anonymous voting ready)
 * 3. "Live" -- auto-navigate after brief success state
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchDuel } from '@/lib/api/duelClient';

export interface DuelCreateResult {
  id: number;
  slug: string;
}

export interface DuelCreationModalProps {
  isOpen: boolean;
  /** Promise that resolves with the new duel's DB id and slug. */
  createPromise: Promise<DuelCreateResult> | null;
  onComplete: (duelId: number, duelSlug: string) => void;
  onError: (error: string) => void;
}

type Phase = 'creating' | 'setting_up' | 'live' | 'error';

const HEX_CHARS = '0123456789abcdef';
const SCRAMBLE_INTERVAL = 80;
const POLL_INTERVAL = 3000;
const LIVE_DURATION = 1500;

const MESSAGES = [
  { text: 'Creating your duel', sub: 'Saving to database...' },
  { text: 'Setting up anonymous voting', sub: 'Deploying to Aztec L2...' },
  { text: 'Almost ready', sub: 'Configuring privacy guarantees...' },
];

function randomHex(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    if (i > 0 && i % 4 === 0) s += ' ';
    s += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return s;
}

export function DuelCreationModal({ isOpen, createPromise, onComplete, onError }: DuelCreationModalProps) {
  const [phase, setPhase] = useState<Phase>('creating');
  const [scrambledText, setScrambledText] = useState('');
  const [messageIndex, setMessageIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const duelIdRef = useRef<number | null>(null);
  const duelSlugRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPhase('creating');
    setMessageIndex(0);
    setErrorMsg('');
    duelIdRef.current = null;
    duelSlugRef.current = null;
  }, [isOpen]);

  // Scramble animation
  useEffect(() => {
    if (!isOpen || phase === 'live' || phase === 'error') return;
    const interval = setInterval(() => {
      setScrambledText(randomHex(32));
    }, SCRAMBLE_INTERVAL);
    return () => clearInterval(interval);
  }, [isOpen, phase]);

  // Phase 1: Wait for DB creation
  useEffect(() => {
    if (!isOpen || phase !== 'creating' || !createPromise) return;
    let cancelled = false;

    createPromise
      .then((result) => {
        if (cancelled) return;
        duelIdRef.current = result.id;
        duelSlugRef.current = result.slug;
        setPhase('setting_up');
        setMessageIndex(1);
      })
      .catch((err) => {
        if (cancelled) return;
        setPhase('error');
        setErrorMsg(String(err?.message || 'Failed to create duel'));
        onError(String(err?.message || 'Failed to create duel'));
      });

    return () => { cancelled = true; };
  }, [isOpen, phase, createPromise, onError]);

  // Phase 2: Poll until on_chain_id is set
  useEffect(() => {
    if (!isOpen || phase !== 'setting_up' || !duelIdRef.current) return;
    const duelId = duelIdRef.current;
    let cancelled = false;

    const poll = async () => {
      try {
        const duel = await fetchDuel(duelId);
        if (cancelled) return;
        if (duel.onChainId !== null) {
          setPhase('live');
          setMessageIndex(2);
        }
      } catch { /* retry next interval */ }
    };

    // Poll immediately, then on interval
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL);

    // Timeout: proceed after 60s even if on_chain_id isn't set yet
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setPhase('live');
      }
    }, 60_000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      clearTimeout(timeout);
    };
  }, [isOpen, phase]);

  // Phase 3: Auto-navigate after brief success state
  useEffect(() => {
    if (!isOpen || phase !== 'live') return;
    const timer = setTimeout(() => {
      if (duelIdRef.current) onComplete(duelIdRef.current, duelSlugRef.current || String(duelIdRef.current));
    }, LIVE_DURATION);
    return () => clearTimeout(timer);
  }, [isOpen, phase, onComplete]);

  // Cycle messages during setting_up
  useEffect(() => {
    if (!isOpen || phase !== 'setting_up') return;
    const timer = setInterval(() => {
      setMessageIndex((prev) => Math.min(prev + 1, MESSAGES.length - 1));
    }, 4000);
    return () => clearInterval(timer);
  }, [isOpen, phase]);

  const currentMessage = MESSAGES[messageIndex] || MESSAGES[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl p-8 shadow-2xl"
          >
            <AnimatePresence mode="wait">
              {/* Creating + Setting Up */}
              {(phase === 'creating' || phase === 'setting_up') && (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-center space-y-6"
                >
                  <div className="relative w-16 h-16 mx-auto">
                    <div className="absolute inset-0 bg-accent/20 rounded-full animate-ping" />
                    <div className="relative w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                  </div>

                  <div className="min-h-[3.5rem]">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={messageIndex}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        <h3 className="text-lg font-semibold text-foreground mb-1">{currentMessage.text}</h3>
                        <p className="text-sm text-foreground-muted">{currentMessage.sub}</p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <div className="bg-background-secondary rounded-lg p-4 font-mono text-xs text-accent/70 tracking-wider overflow-hidden">
                    <div className="opacity-80">0x{scrambledText}</div>
                    <div className="opacity-60 mt-1">0x{randomHex(32)}</div>
                    <div className="opacity-40 mt-1">0x{randomHex(32)}</div>
                  </div>

                  <div className="flex justify-center gap-2">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                          i <= messageIndex ? 'bg-accent' : 'bg-accent/20'
                        }`}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Live */}
              {phase === 'live' && (
                <motion.div
                  key="live"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="text-center space-y-4"
                >
                  <div className="w-16 h-16 mx-auto bg-status-success/10 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Your duel is live!</h3>
                  <p className="text-sm text-foreground-muted">Anonymous voting is ready. Redirecting...</p>
                </motion.div>
              )}

              {/* Error */}
              {phase === 'error' && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-center space-y-4"
                >
                  <div className="w-16 h-16 mx-auto bg-status-error/10 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Creation Failed</h3>
                  <p className="text-sm text-foreground-muted">{errorMsg}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
