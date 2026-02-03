'use client';

import { useState, useCallback, useEffect } from 'react';

export interface WizardStep<T extends string> {
  id: T;
  label: string;
  description?: string;
  validate?: (config: Record<string, any>) => string | null;
}

export interface UseWizardOptions<T extends string, C> {
  steps: WizardStep<T>[];
  initialConfig: C;
  storageKey?: string; // For localStorage draft persistence
  onComplete?: (config: C) => Promise<void>;
}

export interface UseWizardReturn<T extends string, C> {
  // Current state
  currentStep: T;
  currentStepIndex: number;
  steps: WizardStep<T>[];
  config: C;

  // Navigation
  goToStep: (step: T) => void;
  goNext: () => boolean; // Returns false if validation fails
  goBack: () => void;

  // Config management
  updateConfig: (updates: Partial<C>) => void;
  resetConfig: () => void;

  // Validation
  validateCurrentStep: () => string | null;
  canProceed: boolean;
  validationError: string | null;

  // Progress
  isFirstStep: boolean;
  isLastStep: boolean;
  progress: number; // 0-100

  // Draft persistence
  saveDraft: () => void;
  loadDraft: () => boolean; // Returns true if draft was loaded
  clearDraft: () => void;
  hasDraft: boolean;

  // Submission
  isSubmitting: boolean;
  submitError: string | null;
  submit: () => Promise<void>;
}

/**
 * Hook for managing multi-step wizard state with validation and draft persistence
 */
export function useWizard<T extends string, C extends Record<string, any>>({
  steps,
  initialConfig,
  storageKey,
  onComplete,
}: UseWizardOptions<T, C>): UseWizardReturn<T, C> {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [config, setConfig] = useState<C>(initialConfig);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const currentStep = steps[currentStepIndex].id;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  // Draft persistence disabled — will be added later

  const validateCurrentStep = useCallback((): string | null => {
    const step = steps[currentStepIndex];
    if (step.validate) {
      return step.validate(config as Record<string, unknown>);
    }
    return null;
  }, [steps, currentStepIndex, config]);

  const canProceed = validateCurrentStep() === null;

  const goToStep = useCallback(
    (step: T) => {
      const index = steps.findIndex((s) => s.id === step);
      if (index !== -1 && index <= currentStepIndex) {
        setValidationError(null);
        setCurrentStepIndex(index);
      }
    },
    [steps, currentStepIndex]
  );

  const goNext = useCallback((): boolean => {
    const error = validateCurrentStep();
    if (error) {
      setValidationError(error);
      return false;
    }
    setValidationError(null);
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    }
    return true;
  }, [validateCurrentStep, currentStepIndex, steps.length]);

  const goBack = useCallback(() => {
    setValidationError(null);
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const updateConfig = useCallback((updates: Partial<C>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
    setValidationError(null);
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(initialConfig);
    setCurrentStepIndex(0);
    setValidationError(null);
    setSubmitError(null);
  }, [initialConfig]);

  const saveDraft = useCallback(() => {
    if (storageKey && typeof window !== 'undefined') {
      const draft = {
        config,
        stepIndex: currentStepIndex,
        savedAt: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(draft));
      setHasDraft(true);
    }
  }, [storageKey, config, currentStepIndex]);

  const loadDraft = useCallback((): boolean => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setConfig(draft.config);
          setCurrentStepIndex(Math.min(draft.stepIndex, steps.length - 1));
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }, [storageKey, steps.length]);

  const clearDraft = useCallback(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.removeItem(storageKey);
      setHasDraft(false);
    }
  }, [storageKey]);

  const submit = useCallback(async () => {
    if (!onComplete) return;

    // Validate all steps before submitting
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.validate) {
        const error = step.validate(config as Record<string, unknown>);
        if (error) {
          setCurrentStepIndex(i);
          setValidationError(error);
          return;
        }
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onComplete(config);
      clearDraft();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to complete wizard');
    } finally {
      setIsSubmitting(false);
    }
  }, [onComplete, steps, config, clearDraft]);


  return {
    currentStep,
    currentStepIndex,
    steps,
    config,
    goToStep,
    goNext,
    goBack,
    updateConfig,
    resetConfig,
    validateCurrentStep,
    canProceed,
    validationError,
    isFirstStep,
    isLastStep,
    progress,
    saveDraft,
    loadDraft,
    clearDraft,
    hasDraft,
    isSubmitting,
    submitError,
    submit,
  };
}
