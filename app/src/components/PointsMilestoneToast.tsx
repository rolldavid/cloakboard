import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/index';

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const STORAGE_KEY = 'duelcloak_milestones_seen';
const CREATE_THRESHOLD = parseInt((import.meta as any).env?.VITE_CREATE_DUEL_THRESHOLD || '10', 10);

function getSeenMilestones(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function markMilestoneSeen(milestone: number): void {
  try {
    const seen = getSeenMilestones();
    seen.add(milestone);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch { /* ignore */ }
}

function getMilestoneMessage(milestone: number): { title: string; message: string; showCreate: boolean } {
  if (milestone === CREATE_THRESHOLD) {
    return {
      title: `${milestone} points reached!`,
      message: "You've earned enough to create your own duel. Stake your points and start a debate.",
      showCreate: true,
    };
  }
  if (milestone <= 25) {
    return {
      title: `${milestone} points!`,
      message: 'Keep voting to earn more. Once you have enough, you can create your own duels.',
      showCreate: false,
    };
  }
  if (milestone <= 100) {
    return {
      title: `${milestone} whisper points!`,
      message: 'You could stake these to create a duel and earn even more back.',
      showCreate: true,
    };
  }
  return {
    title: `${milestone} points!`,
    message: 'Higher stakes mean bigger rewards. Create a duel and put your points to work.',
    showCreate: true,
  };
}

export function PointsMilestoneToast() {
  const { whisperPoints, isAuthenticated } = useAppStore();
  const [toast, setToast] = useState<{ milestone: number; title: string; message: string; showCreate: boolean } | null>(null);

  const checkMilestone = useCallback((points: number) => {
    if (!isAuthenticated || points <= 0) return;
    const seen = getSeenMilestones();
    // Find the highest milestone just crossed
    for (let i = MILESTONES.length - 1; i >= 0; i--) {
      const m = MILESTONES[i];
      if (points >= m && !seen.has(m)) {
        markMilestoneSeen(m);
        const msg = getMilestoneMessage(m);
        setToast({ milestone: m, ...msg });
        // Auto-dismiss after 6s
        setTimeout(() => setToast((t) => t?.milestone === m ? null : t), 6000);
        break;
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    checkMilestone(whisperPoints);
  }, [whisperPoints, checkMilestone]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -20, x: '-50%' }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed top-16 left-1/2 z-50 w-full max-w-sm px-4"
        >
          <div className="bg-card border border-accent/30 rounded-xl shadow-lg shadow-accent/10 p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{toast.title}</p>
                <p className="text-xs text-foreground-muted mt-0.5 leading-relaxed">{toast.message}</p>
                {toast.showCreate && (
                  <Link
                    to="/create"
                    onClick={() => setToast(null)}
                    className="inline-block mt-2 text-xs font-semibold text-accent hover:underline"
                  >
                    Create a duel &rarr;
                  </Link>
                )}
              </div>
              <button
                onClick={() => setToast(null)}
                className="shrink-0 text-foreground-muted hover:text-foreground"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
