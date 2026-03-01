import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { nameToSlug } from '@/components/wizard/CloakNameInput';
import { fetchFeed } from '@/lib/api/feedClient';

interface DeploymentExperienceProps {
  cloakName: string;
  deployedAddress: string | null;
  error: string | null;
  startTime: number | null;
  onRetry: () => void;
}

// Phase 1: Deploy tx being sent (0-20s)
// Front-loaded: jumps to 20% in the first second so the user sees immediate feedback
const DEPLOY_PHASES = [
  { pct: 20, label: 'Preparing deployment...', endSec: 1 },
  { pct: 35, label: 'Publishing contract to Aztec...', endSec: 5 },
  { pct: 50, label: 'Generating proof & deploying...', endSec: 12 },
  { pct: 65, label: 'Confirming on-chain...', endSec: 20 },
];

// Phase 2: Waiting for first duel to appear in DB (20-60s)
const MINING_PHASES = [
  { pct: 70, label: 'Mining contract on-chain...', endSec: 30 },
  { pct: 80, label: 'Creating your first duel...', endSec: 40 },
  { pct: 90, label: 'Almost ready...', endSec: 50 },
  { pct: 95, label: 'Any moment now...', endSec: 60 },
];

const EDUCATIONAL_CARDS = [
  'Your cloak deploys a smart contract on Aztec L2 -- a privacy-first blockchain.',
  'Votes use zero-knowledge proofs so no one can see how you voted.',
  'Statements are encrypted on-chain in a pool only the council can manage.',
  'Each duel automatically tallies when its duration ends.',
  'Whisper points reward participation -- vote, comment, and star duels to earn.',
  'Your first duel is being committed on-chain right now.',
  'Once live, anyone can cast a fully anonymous vote.',
];

function ConfettiParticle({ delay }: { delay: number }) {
  const style = useMemo(() => {
    const hue = Math.random() * 360;
    const left = Math.random() * 100;
    const size = 4 + Math.random() * 6;
    const duration = 1.5 + Math.random() * 1.5;
    return { hue, left, size, duration };
  }, []);

  return (
    <motion.div
      initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
      animate={{
        y: 400,
        x: (Math.random() - 0.5) * 200,
        opacity: 0,
        rotate: Math.random() * 720 - 360,
      }}
      transition={{ duration: style.duration, delay, ease: 'easeIn' }}
      className="absolute pointer-events-none"
      style={{
        left: `${style.left}%`,
        width: style.size,
        height: style.size,
        backgroundColor: `hsl(${style.hue}, 80%, 60%)`,
        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      }}
    />
  );
}

export function DeploymentExperience({
  cloakName,
  deployedAddress,
  error,
  startTime,
  onRetry,
}: DeploymentExperienceProps) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [duelReady, setDuelReady] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slug = nameToSlug(cloakName);

  // Elapsed timer — runs until duel is ready or error
  useEffect(() => {
    if (!startTime || duelReady || error) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, duelReady, error]);

  // Rotate educational cards
  useEffect(() => {
    if (duelReady || error) return;
    const interval = setInterval(() => {
      setCardIndex((prev) => (prev + 1) % EDUCATIONAL_CARDS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [duelReady, error]);

  // Prevent tab close during deployment
  useEffect(() => {
    if (duelReady || error) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [duelReady, error]);

  // Poll for first duel once we have the address
  useEffect(() => {
    if (!deployedAddress || duelReady || error) return;
    let cancelled = false;

    const poll = async (attempt = 0) => {
      if (cancelled || attempt > 40) return; // ~2 min max
      try {
        const result = await fetchFeed({ cloak: slug, limit: 1 });
        if (cancelled) return;
        if (result.duels.length > 0) {
          setDuelReady(true);
          return;
        }
      } catch (err: any) {
        if (cancelled) return;
        // Back off longer on rate limit
        if (err?.message?.includes('429') || err?.message?.includes('Too Many')) {
          pollRef.current = setTimeout(() => poll(attempt + 1), 10_000);
          return;
        }
      }
      // Normal interval: 3s between polls
      pollRef.current = setTimeout(() => poll(attempt + 1), 3000);
    };

    poll();

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [deployedAddress, slug, duelReady, error]);

  // Auto-navigate when duel is ready
  useEffect(() => {
    if (!duelReady) return;
    const timeout = setTimeout(() => {
      navigate(`/c/${slug}`);
    }, 2500);
    return () => clearTimeout(timeout);
  }, [duelReady, slug, navigate]);

  // Calculate progress — two-phase: deploy (0-65%) then mining/duel (65-100%)
  let progress = 0;
  let phaseLabel = DEPLOY_PHASES[0].label;

  if (duelReady) {
    progress = 100;
    phaseLabel = 'Your duel is live!';
  } else if (error) {
    phaseLabel = 'Deployment failed';
  } else if (!deployedAddress) {
    // Phase 1: deploying
    for (let i = DEPLOY_PHASES.length - 1; i >= 0; i--) {
      const phase = DEPLOY_PHASES[i];
      const prevEnd = i > 0 ? DEPLOY_PHASES[i - 1].endSec : 0;
      if (elapsed >= prevEnd) {
        const phaseProgress = Math.min(1, (elapsed - prevEnd) / (phase.endSec - prevEnd));
        const eased = 1 - (1 - phaseProgress) * (1 - phaseProgress);
        const prevPct = i > 0 ? DEPLOY_PHASES[i - 1].pct : 0;
        progress = prevPct + (phase.pct - prevPct) * eased;
        phaseLabel = phase.label;
        if (elapsed >= phase.endSec && i < DEPLOY_PHASES.length - 1) continue;
        break;
      }
    }
    if (elapsed > 20) {
      progress = Math.min(65, 65 + (elapsed - 20) * 0.05);
      phaseLabel = 'Wrapping up deploy...';
    }
  } else {
    // Phase 2: address received, waiting for duel in DB
    for (let i = MINING_PHASES.length - 1; i >= 0; i--) {
      const phase = MINING_PHASES[i];
      const prevEnd = i > 0 ? MINING_PHASES[i - 1].endSec : DEPLOY_PHASES[DEPLOY_PHASES.length - 1].endSec;
      if (elapsed >= prevEnd) {
        const phaseProgress = Math.min(1, (elapsed - prevEnd) / (phase.endSec - prevEnd));
        const eased = 1 - (1 - phaseProgress) * (1 - phaseProgress);
        const prevPct = i > 0 ? MINING_PHASES[i - 1].pct : DEPLOY_PHASES[DEPLOY_PHASES.length - 1].pct;
        progress = prevPct + (phase.pct - prevPct) * eased;
        phaseLabel = phase.label;
        if (elapsed >= phase.endSec && i < MINING_PHASES.length - 1) continue;
        break;
      }
    }
    if (elapsed > 60) {
      progress = Math.min(99, 95 + (elapsed - 60) * 0.05);
      phaseLabel = 'Still working...';
    }
  }

  const progressColor = error
    ? 'bg-status-error'
    : duelReady
      ? 'bg-status-success'
      : 'bg-accent';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-xl p-8 shadow-2xl text-center">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          {duelReady ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="w-16 h-16 rounded-full bg-status-success/20 flex items-center justify-center"
            >
              <svg className="w-8 h-8 text-status-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </motion.div>
          ) : error ? (
            <div className="w-16 h-16 rounded-full bg-status-error/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-status-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center"
            >
              <span className="text-2xl font-bold text-accent">DC</span>
            </motion.div>
          )}
        </div>

        {/* Title */}
        <h2 className="text-lg font-bold text-foreground mb-1">
          {duelReady
            ? `c/${cloakName} is live!`
            : error
              ? 'Deployment Failed'
              : `Creating c/${cloakName}`}
        </h2>

        {/* Progress bar */}
        {!error && (
          <div className="space-y-2 mb-6">
            <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${progressColor}`}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            <p className="text-sm text-foreground-muted">{phaseLabel}</p>
          </div>
        )}

        {/* Duel ready — success */}
        {duelReady && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <p className="text-sm text-foreground-muted">Your first duel is ready for voting</p>
            <button
              onClick={() => navigate(`/c/${slug}`)}
              className="px-6 py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
            >
              Go to your cloak
            </button>

            {/* Confetti */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
              {Array.from({ length: 40 }).map((_, i) => (
                <ConfettiParticle key={i} delay={i * 0.03} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 mt-4"
          >
            <p className="text-sm text-status-error">{error}</p>
            <button
              onClick={onRetry}
              className="px-6 py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
            >
              Try Again
            </button>
          </motion.div>
        )}

        {/* In-progress */}
        {!duelReady && !error && (
          <>
            {/* Educational card */}
            <div className="h-14 flex items-center justify-center mb-4">
              <AnimatePresence mode="wait">
                <motion.p
                  key={cardIndex}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                  className="text-sm text-foreground-secondary px-2"
                >
                  {EDUCATIONAL_CARDS[cardIndex]}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Encryption visualizer */}
            <div className="font-mono text-xs text-foreground-muted/40 overflow-hidden h-5 mb-3">
              <motion.span
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ repeat: Infinity, duration: 3 }}
              >
                0x{Array.from({ length: 32 }).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}
              </motion.span>
            </div>

            {/* Timer */}
            <p className="text-xs text-foreground-muted">{elapsed}s elapsed</p>
          </>
        )}
      </div>
    </div>
  );
}
