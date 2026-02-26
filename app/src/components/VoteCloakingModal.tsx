/**
 * Vote Cloaking Modal -- full-screen overlay shown during vote proof generation.
 *
 * Phases:
 * 1. "Cloaking your vote" -- text scrambles into ciphertext while proof generates
 * 2. "Earning Whisper Points" -- points count-up animation + confetti (skipped if already voted)
 * 3. "Vote Confirmed" -- checkmark, auto-close after 2s
 * X. "Already Voted" -- error state, no points/confetti
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface VoteCloakingModalProps {
  isOpen: boolean;
  votePromise: Promise<void> | null;
  currentPoints: number;
  pointsToAdd: number;
  onComplete: () => void;
  /** If true, the vote failed because user already voted. Skips points/confetti. */
  alreadyVoted?: boolean;
}

type Phase = 'cloaking' | 'points' | 'confirmed' | 'already_voted';

const HEX_CHARS = '0123456789abcdef';
const SCRAMBLE_INTERVAL = 80;
const MIN_CLOAK_DURATION = 3000;
const POINTS_DURATION = 2000;
const CONFIRMED_DURATION = 2000;

function randomHex(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    if (i > 0 && i % 4 === 0) s += ' ';
    s += HEX_CHARS[Math.floor(Math.random() * 16)];
  }
  return s;
}

export function VoteCloakingModal({
  isOpen,
  votePromise,
  currentPoints,
  pointsToAdd,
  onComplete,
  alreadyVoted,
}: VoteCloakingModalProps) {
  const [phase, setPhase] = useState<Phase>('cloaking');
  const [scrambledText, setScrambledText] = useState('');
  const [displayPoints, setDisplayPoints] = useState(0);
  const [confettiPieces, setConfettiPieces] = useState<{ id: number; x: number; delay: number; color: string; size: number }[]>([]);
  const voteResolvedRef = useRef(false);
  const phaseStartRef = useRef(Date.now());
  const pointsAnimatedRef = useRef(false);

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPhase('cloaking');
    setDisplayPoints(currentPoints);
    setConfettiPieces([]);
    voteResolvedRef.current = false;
    pointsAnimatedRef.current = false;
    phaseStartRef.current = Date.now();
  }, [isOpen, currentPoints]);

  // If alreadyVoted is set while modal is open, jump to already_voted phase
  useEffect(() => {
    if (!isOpen || !alreadyVoted) return;
    setPhase('already_voted');
  }, [isOpen, alreadyVoted]);

  // Phase 1: Scramble animation
  useEffect(() => {
    if (!isOpen || phase !== 'cloaking') return;
    const interval = setInterval(() => {
      setScrambledText(randomHex(32));
    }, SCRAMBLE_INTERVAL);
    return () => clearInterval(interval);
  }, [isOpen, phase]);

  // Wait for vote promise + minimum duration, then transition to Phase 2
  useEffect(() => {
    if (!isOpen || phase !== 'cloaking' || !votePromise) return;
    let cancelled = false;

    const minTimer = new Promise<void>(r => setTimeout(r, MIN_CLOAK_DURATION));

    Promise.all([
      votePromise.then(() => { voteResolvedRef.current = true; }).catch(() => { voteResolvedRef.current = true; }),
      minTimer,
    ]).then(() => {
      if (!cancelled && !alreadyVoted) {
        setPhase('points');
        phaseStartRef.current = Date.now();
      }
    });

    return () => { cancelled = true; };
  }, [isOpen, phase, votePromise, alreadyVoted]);

  // Phase 2: Points count-up animation (runs only once, skipped for already_voted)
  useEffect(() => {
    if (!isOpen || phase !== 'points') return;
    if (pointsAnimatedRef.current) return;
    pointsAnimatedRef.current = true;

    const startTime = Date.now();
    const duration = 800;
    const start = currentPoints;
    const target = currentPoints + pointsToAdd;

    setDisplayPoints(start);
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayPoints(Math.round(start + (target - start) * eased));

      if (progress >= 1) clearInterval(interval);
    }, 16);

    // Trigger confetti
    const pieces = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.5,
      color: ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#34d399', '#fbbf24'][Math.floor(Math.random() * 6)],
      size: 4 + Math.random() * 6,
    }));
    setConfettiPieces(pieces);

    // Transition to Phase 3 after POINTS_DURATION
    const timer = setTimeout(() => {
      setPhase('confirmed');
      phaseStartRef.current = Date.now();
    }, POINTS_DURATION);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [isOpen, phase, pointsToAdd, currentPoints]);

  // Phase 3: Auto-close after CONFIRMED_DURATION
  useEffect(() => {
    if (!isOpen || phase !== 'confirmed') return;
    const timer = setTimeout(onComplete, CONFIRMED_DURATION);
    return () => clearTimeout(timer);
  }, [isOpen, phase, onComplete]);

  const handleDismiss = useCallback(() => {
    if (phase === 'confirmed' || phase === 'already_voted') onComplete();
  }, [phase, onComplete]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Phase 1: Cloaking */}
        {phase === 'cloaking' && (
          <div className="text-center space-y-6">
            {/* Shield icon with pulse */}
            <div className="relative w-16 h-16 mx-auto">
              <div className="absolute inset-0 bg-accent/20 rounded-full animate-ping" />
              <div className="relative w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Cloaking your vote</h3>
              <p className="text-sm text-foreground-muted">Generating zero-knowledge proof...</p>
            </div>

            {/* Scrambled ciphertext */}
            <div className="bg-background-secondary rounded-lg p-4 font-mono text-xs text-accent/70 tracking-wider overflow-hidden">
              <div className="opacity-80">0x{scrambledText}</div>
              <div className="opacity-60 mt-1">0x{randomHex(32)}</div>
              <div className="opacity-40 mt-1">0x{randomHex(32)}</div>
            </div>

            {/* Progress dots */}
            <div className="flex justify-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-accent rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Phase 2: Points */}
        {phase === 'points' && (
          <div className="text-center space-y-6">
            {/* Star icon */}
            <div className="w-16 h-16 mx-auto bg-accent/10 rounded-full flex items-center justify-center animate-pulse">
              <svg className="w-8 h-8 text-accent" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Whisper Points Earned!</h3>
              <p className="text-sm text-foreground-muted">+{pointsToAdd} points for voting</p>
            </div>

            {/* Points counter */}
            <div className="text-5xl font-bold text-accent tabular-nums min-w-[4ch] text-center mx-auto">
              {displayPoints}
            </div>

            <p className="text-xs text-foreground-muted">
              Private on-chain points -- only you can see these
            </p>

            {/* Confetti */}
            {confettiPieces.map((piece) => (
              <div
                key={piece.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${piece.x}%`,
                  top: '-10px',
                  width: piece.size,
                  height: piece.size,
                  backgroundColor: piece.color,
                  borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                  animation: `confetti-fall 1.5s ease-in ${piece.delay}s forwards`,
                }}
              />
            ))}
          </div>
        )}

        {/* Phase 3: Confirmed */}
        {phase === 'confirmed' && (
          <div className="text-center space-y-6">
            {/* Checkmark */}
            <div className="w-16 h-16 mx-auto bg-status-success/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Vote Confirmed</h3>
              <p className="text-sm text-foreground-muted">Your vote has been privately recorded</p>
            </div>

            <div className="text-5xl font-bold text-accent tabular-nums min-w-[4ch] text-center mx-auto">
              {currentPoints + pointsToAdd}
            </div>

            <p className="text-xs text-foreground-muted">
              Total whisper points
            </p>

            <button
              onClick={onComplete}
              className="text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              Tap to dismiss
            </button>
          </div>
        )}

        {/* Already Voted */}
        {phase === 'already_voted' && (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 mx-auto bg-status-warning/10 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-foreground mb-1">Already Voted</h3>
              <p className="text-sm text-foreground-muted">You have already cast your vote on this duel</p>
            </div>

            <button
              onClick={onComplete}
              className="px-4 py-2 bg-card border border-border text-sm text-foreground hover:bg-card-hover rounded-md transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Confetti keyframes */}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(400px) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
