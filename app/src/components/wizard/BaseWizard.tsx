import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { WizardStepDef } from '@/lib/hooks/useWizard';

interface BaseWizardProps<T extends string> {
  steps: WizardStepDef<T>[];
  currentStepIndex: number;
  direction: 1 | -1;
  progress: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isSubmitting: boolean;
  validationError: string | null;
  submitError: string | null;
  hasDraft: boolean;
  goNext: () => boolean;
  goBack: () => void;
  goToStep: (step: T) => void;
  submit: () => void;
  loadDraft: () => void;
  clearDraft: () => void;
  submitLabel?: string;
  children: ReactNode;
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -24 : 24, opacity: 0 }),
};

export function BaseWizard<T extends string>(props: BaseWizardProps<T>) {
  const {
    steps,
    currentStepIndex,
    direction,
    progress,
    isFirstStep,
    isLastStep,
    isSubmitting,
    validationError,
    submitError,
    hasDraft,
    goNext,
    goBack,
    goToStep,
    submit,
    loadDraft,
    clearDraft,
    submitLabel = 'Create',
    children,
  } = props;

  const [showDraftModal, setShowDraftModal] = useState(hasDraft);

  const handleResumeDraft = () => {
    loadDraft();
    setShowDraftModal(false);
  };

  const handleStartFresh = () => {
    clearDraft();
    setShowDraftModal(false);
  };

  const displayError = validationError || submitError;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Draft restore modal */}
      <AnimatePresence>
        {showDraftModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-lg p-6 max-w-sm mx-4 space-y-4"
            >
              <h3 className="text-lg font-semibold text-foreground">Resume Draft?</h3>
              <p className="text-sm text-foreground-secondary">
                You have an unfinished cloak draft. Would you like to continue where you left off?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleStartFresh}
                  className="flex-1 px-4 py-2 text-sm font-medium text-foreground-secondary border border-border rounded-md hover:bg-background-secondary transition-colors"
                >
                  Start Fresh
                </button>
                <button
                  onClick={handleResumeDraft}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
                >
                  Resume Draft
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => (
            <button
              key={step.id}
              onClick={() => i < currentStepIndex && goToStep(step.id)}
              disabled={i > currentStepIndex}
              className={`text-xs font-medium transition-colors ${
                i === currentStepIndex
                  ? 'text-accent'
                  : i < currentStepIndex
                    ? 'text-foreground-secondary hover:text-foreground cursor-pointer'
                    : 'text-foreground-muted cursor-default'
              }`}
            >
              {step.label}
            </button>
          ))}
        </div>
        <div className="h-1 bg-background-tertiary rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-accent rounded-full"
            initial={false}
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence mode="wait">
        {displayError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-status-error/10 border border-status-error/30 text-status-error rounded-md px-4 py-3 text-sm"
          >
            {displayError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step content */}
      <div className="relative overflow-hidden min-h-[320px]">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStepIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div>
          {isFirstStep ? (
            <Link
              to="/"
              className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
            >
              Cancel
            </Link>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={goBack}
              className="px-4 py-2 text-sm font-medium text-foreground-secondary hover:text-foreground transition-colors"
            >
              Back
            </motion.button>
          )}
        </div>

        <div>
          {isLastStep ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={submit}
              disabled={isSubmitting}
              className="px-6 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Creating...
                </span>
              ) : (
                submitLabel
              )}
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={goNext}
              className="px-6 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
            >
              Continue
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
