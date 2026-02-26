import { useState, useCallback, useRef, useEffect } from 'react';

export interface WizardStepDef<T extends string> {
  id: T;
  label: string;
  validate?: (config: any) => string | null;
}

interface UseWizardOptions<T extends string, C extends Record<string, any>> {
  steps: WizardStepDef<T>[];
  initialConfig: C;
  storageKey?: string;
  onComplete?: (config: C) => Promise<void>;
  onStepChange?: (step: T, config: C, direction: 'forward' | 'back') => void;
}

export function useWizard<T extends string, C extends Record<string, any>>(
  options: UseWizardOptions<T, C>,
) {
  const { steps, initialConfig, storageKey, onComplete, onStepChange } = options;

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [config, setConfig] = useState<C>(initialConfig);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hasDraft, setHasDraft] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;

  // Check for draft on mount
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHasDraft(true);
    } catch {}
  }, [storageKey]);

  const currentStep = steps[currentStepIndex];

  const updateConfig = useCallback((partial: Partial<C>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
    setValidationError(null);
  }, []);

  const validateStep = useCallback(
    (index: number): string | null => {
      const step = steps[index];
      if (step.validate) {
        return step.validate(configRef.current);
      }
      return null;
    },
    [steps],
  );

  const goNext = useCallback(() => {
    const error = validateStep(currentStepIndex);
    if (error) {
      setValidationError(error);
      return false;
    }
    setValidationError(null);
    if (currentStepIndex < steps.length - 1) {
      setDirection(1);
      const nextIndex = currentStepIndex + 1;
      setCurrentStepIndex(nextIndex);
      onStepChange?.(steps[nextIndex].id, configRef.current, 'forward');
    }
    return true;
  }, [currentStepIndex, steps, validateStep, onStepChange]);

  const goBack = useCallback(() => {
    setValidationError(null);
    if (currentStepIndex > 0) {
      setDirection(-1);
      const prevIndex = currentStepIndex - 1;
      setCurrentStepIndex(prevIndex);
      onStepChange?.(steps[prevIndex].id, configRef.current, 'back');
    }
  }, [currentStepIndex, steps, onStepChange]);

  const goToStep = useCallback(
    (stepId: T) => {
      const index = steps.findIndex((s) => s.id === stepId);
      if (index === -1 || index === currentStepIndex) return;
      // Only allow going to completed (previous) steps
      if (index < currentStepIndex) {
        setDirection(index < currentStepIndex ? -1 : 1);
        setCurrentStepIndex(index);
        setValidationError(null);
      }
    },
    [steps, currentStepIndex],
  );

  const submit = useCallback(async () => {
    // Validate all steps
    for (let i = 0; i < steps.length; i++) {
      const error = validateStep(i);
      if (error) {
        setDirection(i < currentStepIndex ? -1 : 1);
        setCurrentStepIndex(i);
        setValidationError(error);
        return;
      }
    }
    setValidationError(null);
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onComplete?.(configRef.current);
    } catch (err: any) {
      setSubmitError(err?.message ?? 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }, [steps, validateStep, currentStepIndex, onComplete]);

  // Draft persistence
  const saveDraft = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ config: configRef.current, stepIndex: currentStepIndex }),
      );
    } catch {}
  }, [storageKey, currentStepIndex]);

  const loadDraft = useCallback(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const { config: savedConfig, stepIndex } = JSON.parse(raw);
      setConfig({ ...initialConfig, ...savedConfig });
      setCurrentStepIndex(Math.min(stepIndex ?? 0, steps.length - 1));
      setHasDraft(false);
    } catch {}
  }, [storageKey, initialConfig, steps.length]);

  const clearDraft = useCallback(() => {
    if (!storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setHasDraft(false);
  }, [storageKey]);

  // Auto-save draft on config or step change
  useEffect(() => {
    if (!storageKey || hasDraft) return;
    const hasContent =
      config.name || config.description || (config.statements && config.statements.length > 0);
    if (hasContent) saveDraft();
  }, [config, currentStepIndex, storageKey, hasDraft, saveDraft]);

  return {
    currentStep,
    currentStepIndex,
    config,
    direction,
    goNext,
    goBack,
    goToStep,
    updateConfig,
    submit,
    validationError,
    submitError,
    isSubmitting,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === steps.length - 1,
    progress: (currentStepIndex + 1) / steps.length,
    steps,
    saveDraft,
    loadDraft,
    clearDraft,
    hasDraft,
    setValidationError,
  };
}
