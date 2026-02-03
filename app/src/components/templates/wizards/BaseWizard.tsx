'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  backdropVariants,
  modalContentVariants,
  slideUp,
  springTransition,
} from '@/lib/motion';
import type { WizardStep as WizardStepType } from '@/lib/hooks/useWizard';

interface BaseWizardProps<T extends string> {
  steps: WizardStepType<T>[];
  currentStepIndex: number;
  progress: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isSubmitting: boolean;
  validationError: string | null;
  submitError: string | null;
  hasDraft: boolean;
  goToStep: (step: T) => void;
  goNext: () => boolean;
  goBack: () => void;
  submit: () => Promise<void>;
  loadDraft: () => boolean;
  clearDraft: () => void;
  children: React.ReactNode;
  submitLabel?: string;
  cancelPath?: string;
}

/**
 * Reusable wizard wrapper with step management, validation, and draft saving
 */
export function BaseWizard<T extends string>({
  steps,
  currentStepIndex,
  progress,
  isFirstStep,
  isLastStep,
  isSubmitting,
  validationError,
  submitError,
  hasDraft,
  goToStep,
  goNext,
  goBack,
  submit,
  loadDraft,
  clearDraft,
  children,
  submitLabel = 'Create',
  cancelPath = '/',
}: BaseWizardProps<T>) {
  const router = useRouter();
  const [showDraftModal, setShowDraftModal] = useState(false);
  const prevStepRef = useRef(currentStepIndex);
  const [direction, setDirection] = useState(1);

  // Track step direction for slide animation
  useEffect(() => {
    setDirection(currentStepIndex > prevStepRef.current ? 1 : -1);
    prevStepRef.current = currentStepIndex;
  }, [currentStepIndex]);

  // Check for draft on mount
  useEffect(() => {
    if (hasDraft) {
      setShowDraftModal(true);
    }
  }, [hasDraft]);

  const handleDraftRestore = () => {
    loadDraft();
    setShowDraftModal(false);
  };

  const handleDraftDiscard = () => {
    clearDraft();
    setShowDraftModal(false);
  };

  const handleSubmit = async () => {
    await submit();
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Draft Restore Modal */}
      <AnimatePresence>
        {showDraftModal && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/50 z-50"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={handleDraftDiscard}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
              <motion.div
                className="bg-card rounded-md max-w-md w-full p-6 pointer-events-auto"
                variants={modalContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <h3 className="text-lg font-semibold text-foreground mb-2">Resume Draft?</h3>
                <p className="text-foreground-secondary mb-4">
                  You have an unsaved draft from a previous session. Would you like to continue where you
                  left off?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleDraftDiscard}
                    className="flex-1 px-4 py-2 border border-border text-foreground-secondary hover:bg-card-hover rounded-md transition-colors"
                  >
                    Start Fresh
                  </button>
                  <button
                    onClick={handleDraftRestore}
                    className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
                  >
                    Resume Draft
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => index <= currentStepIndex && goToStep(step.id)}
              disabled={index > currentStepIndex}
              className={`text-sm font-medium transition-colors ${
                index === currentStepIndex
                  ? 'text-accent'
                  : index < currentStepIndex
                    ? 'text-foreground-secondary hover:text-foreground cursor-pointer'
                    : 'text-foreground-muted cursor-not-allowed'
              }`}
            >
              {step.label}
            </button>
          ))}
        </div>
        <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
          <motion.div
            className="h-2 bg-accent rounded-full"
            animate={{ width: `${progress}%` }}
            transition={springTransition}
          />
        </div>
      </div>

      {/* Error Display */}
      <AnimatePresence mode="wait">
        {(validationError || submitError) && (
          <motion.div
            className="mb-6 p-4 bg-status-error/10 border border-status-error/20 rounded-md"
            variants={slideUp}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-status-error">{validationError || submitError}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step Content */}
      <div className="bg-card border border-border rounded-md p-6">
        <motion.div
          key={currentStepIndex}
          initial={{ opacity: 0, x: direction > 0 ? 16 : -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={isFirstStep ? () => router.push(cancelPath) : goBack}
          disabled={isSubmitting}
          className="px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary rounded-md transition-colors disabled:opacity-50"
        >
          {isFirstStep ? 'Cancel' : 'Back'}
        </button>

        {isLastStep ? (
          <motion.button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-md font-medium transition-colors flex items-center gap-2"
            whileTap={{ scale: 0.97 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            {isSubmitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {isSubmitting ? 'Creating...' : submitLabel}
          </motion.button>
        ) : (
          <motion.button
            onClick={goNext}
            disabled={isSubmitting}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
            whileTap={{ scale: 0.97 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            Continue
          </motion.button>
        )}
      </div>

      {/* Auto-save indicator */}
      <div className="text-center mt-4">
        <p className="text-xs text-foreground-muted">Your progress is automatically saved</p>
      </div>
    </div>
  );
}
