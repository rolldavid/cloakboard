import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store';
import { CloakOwl } from '@/components/ui/CloakOwl';

const STEPS = [
  {
    title: 'Vote privately, earn points',
    description: 'Cast anonymous votes on duels and engage with the community. Every vote earns you whisper points.',
  },
  {
    title: 'Stake to create duels',
    description: 'Wager your points to launch duels for the community. Your stake backs the debate.',
  },
  {
    title: 'Earn rewards',
    description: 'The more people participate in your duel, the more points you earn back. Popular duels pay off big.',
  },
];

export function WelcomeModal() {
  const { showWelcomeModal, setShowWelcomeModal, userName } = useAppStore();

  if (!showWelcomeModal) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowWelcomeModal(false)}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative w-full max-w-sm bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 pt-7 pb-4 text-center">
            <CloakOwl size="lg" className="mx-auto mb-3" />
            <h2 className="text-xl font-bold text-foreground">
              Welcome{userName ? `, ${userName}` : ''}
            </h2>
            <p className="text-sm text-foreground-muted mt-1">
              Here's how Cloakboard works
            </p>
          </div>

          {/* Steps */}
          <div className="px-6 pb-2 space-y-4">
            {STEPS.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.25 }}
                className="flex gap-3.5"
              >
                <div className="shrink-0 w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-base font-bold text-accent">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
                  <p className="text-xs text-foreground-muted mt-0.5 leading-relaxed">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-6 pt-5 pb-6">
            <button
              onClick={() => setShowWelcomeModal(false)}
              className="w-full py-3 text-sm font-semibold bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors shadow-sm shadow-accent/20"
            >
              Let's go
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
