import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store';
import { CloakOwl } from '@/components/ui/CloakOwl';

const STEPS = [
  {
    icon: (
      <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: 'Vote privately, earn points',
    description: 'Cast anonymous votes on duels and engage with the community. Every vote earns you whisper points.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Stake to create duels',
    description: 'Wager your points to launch duels for the community. Your stake backs the debate.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
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
                <div className="shrink-0 w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  {step.icon}
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
