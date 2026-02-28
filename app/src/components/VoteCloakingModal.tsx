/**
 * Vote Cloaking Modal -- full-screen overlay shown during vote proof generation.
 *
 * Phases:
 * 1. "Cloaking" -- 4 privacy education messages cycle while IVC proof runs (~10-15s)
 * 2. "Earning Whisper Points" -- points count-up animation + confetti (skipped if already voted)
 * 3. "Vote Confirmed" -- checkmark, auto-close after 1.5s
 * X. "Already Voted" -- error state, no points/confetti
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';

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
const MESSAGE_INTERVAL = 3000; // 3s per privacy message
const POINTS_DURATION = 2800;
const CONFIRMED_DURATION = 2500;

const PRIVACY_MESSAGES = [
  {
    text: 'Your vote is 100% private',
    sub: 'A zero-knowledge proof is being generated in your browser',
  },
  {
    text: 'Nobody ever sees that you voted, or how you voted',
    sub: 'Not even this app can see your vote',
  },
  {
    text: '...but the vote total is still updated',
    sub: 'The proof guarantees your vote is counted without revealing it',
  },
  {
    text: "That's the magic of cryptography",
    sub: 'Your proof is almost ready',
  },
];

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
  const [messageIndex, setMessageIndex] = useState(0);
  const voteResolvedRef = useRef(false);
  const phaseStartRef = useRef(Date.now());
  const pointsAnimatedRef = useRef(false);

  // useSpring for points count-up (replaces manual setInterval)
  const pointsSpring = useSpring(currentPoints, { stiffness: 80, damping: 15 });
  const displayPointsMotion = useTransform(pointsSpring, (v) => Math.round(v));

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPhase('cloaking');
    setDisplayPoints(currentPoints);
    pointsSpring.jump(currentPoints);
    setConfettiPieces([]);
    setMessageIndex(0);
    voteResolvedRef.current = false;
    pointsAnimatedRef.current = false;
    phaseStartRef.current = Date.now();
  }, [isOpen, currentPoints, pointsSpring]);

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

  // Phase 1: Cycle through privacy messages
  useEffect(() => {
    if (!isOpen || phase !== 'cloaking') return;
    setMessageIndex(0);
    const timer = setInterval(() => {
      setMessageIndex((prev) => Math.min(prev + 1, PRIVACY_MESSAGES.length - 1));
    }, MESSAGE_INTERVAL);
    return () => clearInterval(timer);
  }, [isOpen, phase]);

  // Phase 1 → Phase 2: Wait for vote proof to complete
  useEffect(() => {
    if (!isOpen || phase !== 'cloaking' || !votePromise) return;
    let cancelled = false;

    votePromise
      .then(() => { voteResolvedRef.current = true; })
      .catch(() => { voteResolvedRef.current = true; });

    votePromise.finally(() => {
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

    // Drive the spring to target
    pointsSpring.set(currentPoints + pointsToAdd);

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
      clearTimeout(timer);
    };
  }, [isOpen, phase, pointsToAdd, currentPoints, pointsSpring]);

  // Phase 3: Auto-close after CONFIRMED_DURATION
  useEffect(() => {
    if (!isOpen || phase !== 'confirmed') return;
    const timer = setTimeout(onComplete, CONFIRMED_DURATION);
    return () => clearTimeout(timer);
  }, [isOpen, phase, onComplete]);

  const handleDismiss = useCallback(() => {
    if (phase === 'points' || phase === 'confirmed' || phase === 'already_voted') onComplete();
  }, [phase, onComplete]);

  // Show "Finalizing..." subtitle when on last message and proof hasn't resolved yet
  const isWaitingOnProof = messageIndex === PRIVACY_MESSAGES.length - 1 && !voteResolvedRef.current;
  const currentMessage = PRIVACY_MESSAGES[messageIndex];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
          onClick={handleDismiss}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Phase content with AnimatePresence for transitions */}
            <AnimatePresence mode="wait">
              {/* Phase 1: Cloaking with privacy messages */}
              {phase === 'cloaking' && (
                <motion.div
                  key="cloaking"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-center space-y-6"
                >
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

                  {/* Privacy message — fades between steps */}
                  <div className="min-h-[4.5rem] flex flex-col items-center justify-center">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={messageIndex}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="flex flex-col items-center"
                      >
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                          {currentMessage.text}
                        </h3>
                        <p className="text-sm text-foreground-muted">
                          {isWaitingOnProof && messageIndex === PRIVACY_MESSAGES.length - 1
                            ? 'Finalizing your proof...'
                            : currentMessage.sub}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Scrambled ciphertext — ambient texture */}
                  <div className="bg-background-secondary rounded-lg p-4 font-mono text-xs text-accent/70 tracking-wider overflow-hidden">
                    <div className="opacity-80">0x{scrambledText}</div>
                    <div className="opacity-60 mt-1">0x{randomHex(32)}</div>
                    <div className="opacity-40 mt-1">0x{randomHex(32)}</div>
                  </div>

                  {/* Progress indicator — dots showing which message we're on */}
                  <div className="flex justify-center gap-2">
                    {PRIVACY_MESSAGES.map((_, i) => (
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

              {/* Phase 2+3: Points count-up -> Confirmed (single DOM, no layout shift) */}
              {(phase === 'points' || phase === 'confirmed') && (
                <motion.div
                  key="points-confirmed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-center space-y-6"
                >
                  {/* Icon — crossfades between star and checkmark */}
                  <div className="relative w-16 h-16 mx-auto">
                    <div
                      className={`absolute inset-0 bg-accent/10 rounded-full flex items-center justify-center transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-0' : 'opacity-100'
                      }`}
                    >
                      <svg className="w-8 h-8 text-accent" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </div>
                    <div
                      className={`absolute inset-0 bg-status-success/10 rounded-full flex items-center justify-center transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-100' : 'opacity-0'
                      }`}
                    >
                      <svg className="w-8 h-8 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>

                  {/* Heading — crossfades between earned and confirmed */}
                  <div className="relative min-h-[3rem]">
                    <div
                      className={`transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-0 absolute inset-0' : 'opacity-100'
                      }`}
                    >
                      <h3 className="text-lg font-semibold text-foreground mb-1">Whisper Points Earned!</h3>
                      <p className="text-sm text-foreground-muted">+{pointsToAdd} points for voting</p>
                    </div>
                    <div
                      className={`transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-100' : 'opacity-0 absolute inset-0'
                      }`}
                    >
                      <h3 className="text-lg font-semibold text-foreground mb-1">Vote Confirmed</h3>
                      <p className="text-sm text-foreground-muted">Your vote has been privately recorded</p>
                    </div>
                  </div>

                  {/* Points counter — driven by useSpring, never unmounts */}
                  <div className="text-5xl font-bold text-accent tabular-nums min-w-[4ch] text-center mx-auto">
                    <motion.span>{displayPointsMotion}</motion.span>
                  </div>

                  {/* Subtitle — crossfades */}
                  <div className="relative min-h-[1.25rem]">
                    <p
                      className={`text-xs text-foreground-muted transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-0 absolute inset-0' : 'opacity-100'
                      }`}
                    >
                      Private on-chain points -- only you can see these
                    </p>
                    <p
                      className={`text-xs text-foreground-muted transition-opacity duration-500 ${
                        phase === 'confirmed' ? 'opacity-100' : 'opacity-0 absolute inset-0'
                      }`}
                    >
                      Total whisper points
                    </p>
                  </div>

                  {/* Tap to dismiss — fades in without pushing layout */}
                  <div className="min-h-[1.5rem]">
                    <button
                      onClick={onComplete}
                      className={`text-sm text-foreground-muted hover:text-foreground transition-all duration-500 ${
                        phase === 'confirmed' ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      Tap to dismiss
                    </button>
                  </div>

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
                </motion.div>
              )}

              {/* Already Voted */}
              {phase === 'already_voted' && (
                <motion.div
                  key="already-voted"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-center space-y-6"
                >
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
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Keyframes */}
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(400px) rotate(720deg); opacity: 0; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
