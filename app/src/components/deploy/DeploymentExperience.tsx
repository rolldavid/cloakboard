import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { nameToSlug } from '@/components/wizard/CloakNameInput';

interface DeploymentExperienceProps {
  cloakName: string;
  deployedAddress: string | null;
  error: string | null;
  startTime: number | null;
  onRetry: () => void;
}

const PHASES = [
  { pct: 15, label: 'Preparing deployment...', endSec: 3 },
  { pct: 45, label: 'Publishing contract to Aztec...', endSec: 8 },
  { pct: 80, label: 'Generating proof & deploying...', endSec: 15 },
  { pct: 95, label: 'Confirming on-chain...', endSec: 20 },
];

const EDUCATIONAL_CARDS = [
  'Your cloak deploys a smart contract on Aztec L2 — a privacy-first blockchain.',
  'Votes use zero-knowledge proofs so no one can see how you voted.',
  'Statements are encrypted on-chain in a pool only the council can manage.',
  'Each duel automatically tallies when its duration ends.',
  'Whisper points reward participation — vote, comment, and star duels to earn.',
];

const ENCOURAGEMENTS = [
  { sec: 15, text: 'Almost there...' },
  { sec: 30, text: 'Aztec is working hard on your proof...' },
  { sec: 45, text: 'Privacy takes a moment — hang tight!' },
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

  // Elapsed timer
  useEffect(() => {
    if (!startTime || deployedAddress || error) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, deployedAddress, error]);

  // Rotate educational cards
  useEffect(() => {
    if (deployedAddress || error) return;
    const interval = setInterval(() => {
      setCardIndex((prev) => (prev + 1) % EDUCATIONAL_CARDS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [deployedAddress, error]);

  // Prevent tab close during deployment
  useEffect(() => {
    if (deployedAddress || error) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [deployedAddress, error]);

  // Auto-redirect on success
  useEffect(() => {
    if (!deployedAddress) return;
    const slug = nameToSlug(cloakName);
    const timeout = setTimeout(() => {
      navigate(`/c/${slug}?fresh=1`);
    }, 3000);
    return () => clearTimeout(timeout);
  }, [deployedAddress, cloakName, navigate]);

  // Calculate progress
  let progress = 0;
  let phaseLabel = PHASES[0].label;

  if (deployedAddress) {
    progress = 100;
    phaseLabel = 'Deployed!';
  } else if (error) {
    progress = progress;
    phaseLabel = 'Deployment failed';
  } else {
    for (let i = PHASES.length - 1; i >= 0; i--) {
      const phase = PHASES[i];
      const prevEnd = i > 0 ? PHASES[i - 1].endSec : 0;
      if (elapsed >= prevEnd) {
        const phaseProgress = Math.min(1, (elapsed - prevEnd) / (phase.endSec - prevEnd));
        const eased = 1 - (1 - phaseProgress) * (1 - phaseProgress); // ease out
        const prevPct = i > 0 ? PHASES[i - 1].pct : 0;
        progress = prevPct + (phase.pct - prevPct) * eased;
        phaseLabel = phase.label;
        if (elapsed >= phase.endSec && i < PHASES.length - 1) continue;
        break;
      }
    }
    if (elapsed > 20) {
      progress = Math.min(98, 95 + (elapsed - 20) * 0.1);
      phaseLabel = 'Wrapping up...';
    }
  }

  const encouragement = [...ENCOURAGEMENTS].reverse().find((e) => elapsed >= e.sec);
  const slug = nameToSlug(cloakName);

  const progressColor = error
    ? 'bg-status-error'
    : deployedAddress
      ? 'bg-status-success'
      : 'bg-accent';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
    >
      <div className="max-w-md w-full mx-4 space-y-8 text-center">
        {/* Pulsing logo / status icon */}
        <div className="flex justify-center">
          {deployedAddress ? (
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

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${progressColor}`}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          <p className="text-sm text-foreground-secondary">{phaseLabel}</p>
        </div>

        {/* Success state */}
        {deployedAddress && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <p className="text-lg font-bold text-foreground">Cloak Deployed!</p>
            <p className="text-xs text-foreground-muted font-mono break-all">
              {deployedAddress}
            </p>
            <button
              onClick={() => navigate(`/c/${slug}?fresh=1`)}
              className="px-6 py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
            >
              Go to your cloak
            </button>
            <p className="text-xs text-foreground-muted">Redirecting in 3 seconds...</p>

            {/* Confetti */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
              {Array.from({ length: 40 }).map((_, i) => (
                <ConfettiParticle key={i} delay={i * 0.03} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Error state */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
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

        {/* In-progress: educational cards + timer */}
        {!deployedAddress && !error && (
          <>
            {/* Educational card */}
            <div className="h-16 flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.p
                  key={cardIndex}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                  className="text-sm text-foreground-secondary px-4"
                >
                  {EDUCATIONAL_CARDS[cardIndex]}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Encryption visualizer */}
            <div className="font-mono text-xs text-foreground-muted/50 overflow-hidden h-6">
              <motion.span
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ repeat: Infinity, duration: 3 }}
              >
                {Array.from({ length: 32 })
                  .map(() => Math.floor(Math.random() * 16).toString(16))
                  .join('')}
              </motion.span>
            </div>

            {/* Timer + encouragement */}
            <div className="space-y-1">
              <p className="text-xs text-foreground-muted">{elapsed}s elapsed</p>
              {encouragement && (
                <p className="text-xs text-foreground-secondary">{encouragement.text}</p>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
