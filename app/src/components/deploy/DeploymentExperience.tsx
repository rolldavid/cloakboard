'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { nameToSlug } from '@/lib/utils/slug';

// --- Types ---

interface DeploymentExperienceProps {
  templateId: number;
  config: any;
  deployedAddress: string | null;
  error: string | null;
}

// --- Phase definitions ---

interface Phase {
  label: string;
  startTime: number; // seconds
  endTime: number;
  startProgress: number;
  endProgress: number;
}

const PHASES: Phase[] = [
  { label: 'Preparing deployment...', startTime: 0, endTime: 10, startProgress: 0, endProgress: 10 },
  { label: 'Publishing contract class to Aztec...', startTime: 10, endTime: 30, startProgress: 10, endProgress: 25 },
  { label: 'Generating zero-knowledge proof...', startTime: 30, endTime: 120, startProgress: 25, endProgress: 70 },
  { label: 'Finalizing on-chain deployment...', startTime: 120, endTime: 240, startProgress: 70, endProgress: 90 },
  { label: 'Registering name on-chain...', startTime: 240, endTime: 300, startProgress: 90, endProgress: 95 },
];

function getPhaseInfo(elapsed: number): { phaseIndex: number; progress: number; label: string } {
  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    if (elapsed < p.endTime) {
      const t = Math.min(1, (elapsed - p.startTime) / (p.endTime - p.startTime));
      // Ease-out for organic feel
      const eased = 1 - Math.pow(1 - t, 2);
      const progress = p.startProgress + (p.endProgress - p.startProgress) * eased;
      return { phaseIndex: i, progress, label: p.label };
    }
  }
  // Past all phases — hold at 95%
  return { phaseIndex: PHASES.length - 1, progress: 95, label: 'Finishing up...' };
}

// --- Educational cards ---

function getEducationalCards(config: any, templateId: number): string[] {
  const cloakName = config?.name || 'Your cloak';

  const privacy = [
    'Right now, your browser is building a mathematical proof that your cloak was created correctly — without revealing any private details to anyone.',
    'Zero-knowledge proofs let you prove something is true without showing how. Like proving you\'re over 21 without showing your ID.',
    'Everything happening right now stays on your device. No server, no cloud, no third party ever sees your private information.',
    'Your browser is doing heavy cryptographic math right now. The same kind of math that protects billions in digital assets.',
    'The proof being generated is tiny — about 1000x smaller than the data behind it. That\'s what makes private blockchains possible.',
    'This is real privacy, not just encryption. Even if someone intercepts the proof, they learn nothing about what\'s inside.',
  ];

  const dynamic: string[] = [
    `${cloakName} is being deployed with full on-chain privacy. Only members will be able to see what happens inside.`,
  ];

  if (templateId === 1) {
    dynamic.push('Your cloak uses Governor Bravo — the gold standard for on-chain governance, now with built-in privacy.');
  }

  if (config?.tokenGate?.method) {
    dynamic.push('Token-gated access means membership is verified cryptographically from your existing tokens — no bridging needed.');
  }

  dynamic.push('Your cloak stores only fingerprints of content on-chain. The actual posts and votes live in private, verified storage.');

  const fun = [
    'Your device is currently a personal cryptography lab. Not bad for a browser tab.',
    'This is the most private way to create a community on a blockchain. Worth every second.',
    'Fun fact: the Aztec network has over 3,400 sequencers across 5 continents processing blocks right now.',
    'Once deployed, your cloak is unstoppable — no one can censor or shut it down.',
  ];

  // Interleave categories
  const cards: string[] = [];
  const maxLen = Math.max(privacy.length, dynamic.length, fun.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < privacy.length) cards.push(privacy[i]);
    if (i < dynamic.length) cards.push(dynamic[i]);
    if (i < fun.length) cards.push(fun[i]);
  }
  return cards;
}

// --- Encouragement messages ---

function getEncouragement(elapsed: number): string | null {
  if (elapsed >= 300) return 'This is taking longer than usual. Please keep this tab open.';
  if (elapsed >= 240) return 'Finishing up... this is the final verification phase.';
  if (elapsed >= 180) return 'Hang tight — complex proofs take time. Your cloak\'s privacy is worth it.';
  if (elapsed >= 120) return 'Almost there... the hardest part of the proof is nearly complete.';
  if (elapsed >= 60) return 'Still generating... ZK proofs are computationally intensive but ensure total privacy.';
  return null;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- Encryption Visualizer ---

function EncryptionVisualizer({ config }: { config: any }) {
  const cloakName = config?.name || 'Your Cloak';
  const messages = useMemo(() => [
    `Welcome to ${cloakName}`,
    'Proposal: Increase treasury allocation',
    'Agent @ResearchBot verified',
    'Vote: Yes on proposal #1',
  ], [cloakName]);

  const [msgIndex, setMsgIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [cipherChars, setCipherChars] = useState<string[]>([]);
  const [fade, setFade] = useState(true);

  const currentMsg = messages[msgIndex % messages.length];

  // Typewriter + cipher effect
  useEffect(() => {
    setCharIndex(0);
    setCipherChars([]);
    setFade(true);
  }, [msgIndex]);

  useEffect(() => {
    if (charIndex >= currentMsg.length) {
      // After full message typed, wait then advance
      const t = setTimeout(() => {
        setFade(false);
        setTimeout(() => setMsgIndex((i) => i + 1), 500);
      }, 2000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setCharIndex((i) => i + 1);
      // Generate a cipher char
      const hex = '0123456789abcdef';
      const c = hex[Math.floor(Math.random() * hex.length)] + hex[Math.floor(Math.random() * hex.length)];
      setCipherChars((prev) => [...prev, c]);
    }, 80);
    return () => clearTimeout(t);
  }, [charIndex, currentMsg.length]);

  // Cycle every 8s as fallback
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => i + 1);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`transition-opacity duration-500 ${fade ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="grid grid-cols-3 gap-3 text-xs font-mono max-w-md mx-auto">
        {/* Plaintext */}
        <div>
          <div className="text-foreground-muted mb-1 text-center font-sans text-[10px] uppercase tracking-wider">Plaintext</div>
          <div className="bg-background-secondary rounded p-2 h-16 overflow-hidden text-foreground text-[11px] leading-relaxed break-all">
            {currentMsg.slice(0, charIndex)}
            {charIndex < currentMsg.length && (
              <span className="animate-pulse text-accent">|</span>
            )}
          </div>
        </div>
        {/* Cipher block */}
        <div>
          <div className="text-foreground-muted mb-1 text-center font-sans text-[10px] uppercase tracking-wider">Encrypting</div>
          <div className="bg-accent-muted rounded p-2 h-16 overflow-hidden flex items-center justify-center">
            <CipherGrid active={charIndex < currentMsg.length} />
          </div>
        </div>
        {/* Ciphertext */}
        <div>
          <div className="text-foreground-muted mb-1 text-center font-sans text-[10px] uppercase tracking-wider">Ciphertext</div>
          <div className="bg-background-secondary rounded p-2 h-16 overflow-hidden text-accent text-[11px] leading-relaxed break-all">
            {cipherChars.join('')}
          </div>
        </div>
      </div>
    </div>
  );
}

function CipherGrid({ active }: { active: boolean }) {
  const [grid, setGrid] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    const hex = '0123456789abcdef';
    const interval = setInterval(() => {
      setGrid(Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]));
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    // Initialize
    const hex = '0123456789abcdef';
    setGrid(Array.from({ length: 16 }, () => hex[Math.floor(Math.random() * 16)]));
  }, [active]);

  return (
    <div className={`grid grid-cols-4 gap-px text-[10px] text-accent font-mono ${active ? 'opacity-100' : 'opacity-30'} transition-opacity`}>
      {grid.map((c, i) => (
        <span key={i} className="text-center">{c}</span>
      ))}
    </div>
  );
}

// --- Confetti ---

function Confetti() {
  const particles = useMemo(() => {
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.5,
      duration: 1.5 + Math.random() * 1.5,
      color: ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6'][Math.floor(Math.random() * 5)],
      size: 4 + Math.random() * 6,
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti"
          style={{
            left: `${p.left}%`,
            top: '-10px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti {
          animation: confetti-fall linear forwards;
        }
      `}</style>
    </div>
  );
}

// --- Main Component ---

export function DeploymentExperience({
  templateId,
  config,
  deployedAddress,
  error,
}: DeploymentExperienceProps) {
  const router = useRouter();
  const startTimeRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardFade, setCardFade] = useState(true);
  const [showConfetti, setShowConfetti] = useState(false);

  const cards = useMemo(() => getEducationalCards(config, templateId), [config, templateId]);

  const isComplete = !!deployedAddress;
  const isError = !!error;

  // Warn before closing/navigating away during deployment
  useEffect(() => {
    if (isComplete || isError) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isComplete, isError]);

  // Elapsed timer
  useEffect(() => {
    if (isComplete || isError) return;
    const interval = setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000);
    }, 200);
    return () => clearInterval(interval);
  }, [isComplete, isError]);

  // Card rotation every 12s
  useEffect(() => {
    if (isComplete || isError) return;
    const interval = setInterval(() => {
      setCardFade(false);
      setTimeout(() => {
        setCardIndex((i) => (i + 1) % cards.length);
        setCardFade(true);
      }, 400);
    }, 12000);
    return () => clearInterval(interval);
  }, [cards.length, isComplete, isError]);

  // Success: confetti + auto-redirect
  useEffect(() => {
    if (!isComplete) return;
    setShowConfetti(true);
    const slug = nameToSlug(config?.name || '');
    const redirectPath = slug ? `/cloak/${slug}` : '/';
    const t = setTimeout(() => {
      router.push(redirectPath);
    }, 3000);
    return () => clearTimeout(t);
  }, [isComplete, config?.name, router]);

  const { progress, label, phaseIndex } = isComplete
    ? { progress: 100, label: 'Deployed!', phaseIndex: PHASES.length }
    : getPhaseInfo(elapsed);

  const encouragement = isComplete ? null : getEncouragement(elapsed);

  const handleGoToCloak = useCallback(() => {
    const slug = nameToSlug(config?.name || '');
    router.push(slug ? `/cloak/${slug}` : '/');
  }, [config?.name, router]);

  return (
    <div className="fixed inset-0 z-40 bg-background flex items-center justify-center">
      {showConfetti && <Confetti />}

      <div className="w-full max-w-lg mx-auto px-6 text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className={`inline-block ${!isComplete && !isError ? 'animate-pulse' : ''}`}>
            <CloakLogo size="lg" showText={false} />
          </div>
        </div>

        {/* Error state */}
        {isError && (
          <div>
            <div className="w-full bg-background-secondary rounded-full h-2 mb-3 overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-red-500 font-medium mb-2">Deployment failed</p>
            <p className="text-sm text-foreground-muted mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Success state */}
        {isComplete && !isError && (
          <div>
            <div className="w-full bg-background-secondary rounded-full h-2 mb-3 overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-700"
                style={{ width: '100%' }}
              />
            </div>
            <p className="text-green-500 font-semibold text-lg mb-1">Your cloak is live on Aztec</p>
            <p className="text-xs text-foreground-muted font-mono mb-4 break-all">{deployedAddress}</p>
            <button
              onClick={handleGoToCloak}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Go to your cloak
            </button>
            <p className="text-xs text-foreground-muted mt-2">Redirecting in a few seconds...</p>
          </div>
        )}

        {/* In-progress state */}
        {!isComplete && !isError && (
          <>
            {/* Progress bar */}
            <div className="w-full bg-background-secondary rounded-full h-2 mb-3 overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-xs text-foreground-muted mb-6">
              <span>Phase {phaseIndex + 1} of {PHASES.length}: {label}</span>
              <span>{Math.round(progress)}%</span>
            </div>

            {/* Educational card — fixed height to prevent layout shift */}
            <div className="bg-card border border-border rounded-lg p-4 mb-6 h-[100px] relative overflow-hidden">
              <div
                className={`absolute inset-0 p-4 flex items-center justify-center transition-opacity duration-400 ${cardFade ? 'opacity-100' : 'opacity-0'}`}
              >
                <p className="text-sm text-foreground-secondary leading-relaxed">
                  {cards[cardIndex]}
                </p>
              </div>
            </div>

            {/* Encryption visualizer */}
            <div className="mb-6">
              <EncryptionVisualizer config={config} />
            </div>

            {/* Timer + encouragement — fixed height to prevent layout shift */}
            <div className="text-xs text-foreground-muted h-[40px]">
              <span>⏱ {formatTime(elapsed)} elapsed</span>
              <p className={`mt-2 text-foreground-secondary transition-opacity duration-300 ${encouragement ? 'opacity-100' : 'opacity-0'}`}>
                {encouragement || '\u00A0'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
