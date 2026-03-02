import { useCallback, useRef, useState, useEffect } from 'react';
import { useWizard, type WizardStepDef } from '@/lib/hooks/useWizard';
import { BaseWizard } from './BaseWizard';
import { WizardStep } from './WizardStep';
import { CloakNameInput } from './CloakNameInput';
import { apiUrl } from '@/lib/api';

export interface DuelConfig {
  name: string;
  description: string;
  duelDuration: number;
  firstDuelDate: string;
  firstDuelTime: string;
  firstDuelBlock: number;
  statements: string[];
  newStatement: string;
}

const INITIAL_CONFIG: DuelConfig = {
  name: '',
  description: '',
  duelDuration: 0, // computed from block rate when preset is selected
  firstDuelDate: '',
  firstDuelTime: '',
  firstDuelBlock: 0,
  statements: [],
  newStatement: '',
};

type StepId = 'basics' | 'timing' | 'statements' | 'review';

const STEPS: WizardStepDef<StepId>[] = [
  {
    id: 'basics',
    label: 'Basics',
    validate: (config: DuelConfig) => {
      if (!config.name.trim()) return 'Cloak name is required';
      if (config.name.length > 31) return 'Name must be 31 characters or less';
      if (!/[a-zA-Z0-9]/.test(config.name)) return 'Name must contain at least one letter or number';
      return null;
    },
  },
  {
    id: 'timing',
    label: 'Timing',
    validate: (config: DuelConfig) => {
      if (config.duelDuration < 1) return 'Select a duel duration';
      return null;
    },
  },
  {
    id: 'statements',
    label: 'Statements',
    validate: (config: DuelConfig) => {
      if (config.statements.length === 0) return 'Add at least one statement';
      const tooLong = config.statements.find((s) => s.length > 1000);
      if (tooLong) return 'Each statement must be 1000 characters or less';
      return null;
    },
  },
  {
    id: 'review',
    label: 'Review',
  },
];

/** Duration presets defined in seconds — blocks computed from measured block rate. */
const DURATION_PRESETS = [
  { label: '10 minutes', seconds: 600 },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 259200 },
  { label: '1 week', seconds: 604800 },
  { label: '1 month', seconds: 2592000 },
];

const DEFAULT_BLOCK_TIME = 6;

function secondsToBlocks(seconds: number, avgBlockTime: number): number {
  return Math.max(1, Math.round(seconds / avgBlockTime));
}

function blocksToHumanTime(blocks: number, avgBlockTime: number): string {
  const seconds = blocks * avgBlockTime;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 604800) return `~${(seconds / 86400).toFixed(1)} days`;
  return `~${(seconds / 604800).toFixed(1)} weeks`;
}

interface DuelWizardProps {
  onSubmit: (config: DuelConfig) => Promise<void>;
}

export function DuelWizard({ onSubmit }: DuelWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avgBlockTime, setAvgBlockTime] = useState(DEFAULT_BLOCK_TIME);

  // Fetch measured block rate from server
  useEffect(() => {
    fetch(apiUrl('/api/block-clock'))
      .then((r) => r.json())
      .then((data) => {
        if (data.avgBlockTime && data.avgBlockTime > 0) {
          setAvgBlockTime(data.avgBlockTime);
        }
      })
      .catch(() => {});
  }, []);

  const wizard = useWizard<StepId, DuelConfig>({
    steps: STEPS,
    initialConfig: INITIAL_CONFIG,
    storageKey: 'duel-cloak-draft',
    onComplete: onSubmit,
  });

  const { config, updateConfig, currentStep } = wizard;

  const addStatement = useCallback(() => {
    const text = config.newStatement.trim();
    if (!text) return;
    if (text.length > 1000) return;
    if (config.statements.includes(text)) return;
    updateConfig({
      statements: [...config.statements, text],
      newStatement: '',
    });
  }, [config.newStatement, config.statements, updateConfig]);

  const removeStatement = useCallback(
    (index: number) => {
      updateConfig({
        statements: config.statements.filter((_, i) => i !== index),
      });
    },
    [config.statements, updateConfig],
  );

  const handleCsvUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const lines = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l.length <= 1000);
        const existing = new Set(config.statements);
        const newStatements = lines.filter((l) => !existing.has(l));
        if (newStatements.length > 0) {
          updateConfig({ statements: [...config.statements, ...newStatements] });
        }
      };
      reader.readAsText(file);
      // Reset file input
      e.target.value = '';
    },
    [config.statements, updateConfig],
  );

  const renderStep = () => {
    switch (currentStep.id) {
      case 'basics':
        return (
          <WizardStep title="Cloak Details" description="Cloaks are communities that host duels for members to vote on.">
            <div className="space-y-4">
              <CloakNameInput
                value={config.name}
                onChange={(name) => updateConfig({ name })}
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={config.description}
                  onChange={(e) => updateConfig({ description: e.target.value })}
                  placeholder="What is this cloak about?"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent resize-none transition-colors"
                />
              </div>

              <div className="bg-status-error/8 border border-status-error/20 rounded-md p-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-status-error mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v.01M12 9v3m0 0a9 9 0 110 0 9 9 0 010 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-foreground">Always Private</p>
                    <p className="text-xs text-foreground-secondary mt-0.5">
                      Only voting results are shared publicly. Individual votes are never revealed.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </WizardStep>
        );

      case 'timing':
        return (
          <WizardStep title="Duel Timing" description="How long each duel lasts and when they begin.">
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">Duel Duration</label>
                <div className="grid grid-cols-4 gap-2">
                  {DURATION_PRESETS.map((preset) => {
                    const blocks = secondsToBlocks(preset.seconds, avgBlockTime);
                    return (
                      <button
                        key={preset.seconds}
                        onClick={() => updateConfig({ duelDuration: blocks })}
                        className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                          config.duelDuration === blocks
                            ? 'border-accent bg-accent/10 text-accent font-medium'
                            : 'border-border text-foreground-secondary hover:border-border-hover hover:text-foreground'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-foreground-muted">
                  {config.duelDuration.toLocaleString()} blocks ({blocksToHumanTime(config.duelDuration, avgBlockTime)}) · {avgBlockTime.toFixed(1)}s per block
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">First Duel Start</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={config.firstDuelDate}
                    onChange={(e) => updateConfig({ firstDuelDate: e.target.value })}
                    className="px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
                  />
                  <input
                    type="time"
                    value={config.firstDuelTime}
                    onChange={(e) => updateConfig({ firstDuelTime: e.target.value })}
                    className="px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
                  />
                </div>
                <p className="text-xs text-foreground-muted">
                  Leave empty to allow duels to start immediately after creation.
                </p>
              </div>

              <div className="bg-background-secondary border border-border rounded-md p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">How Duels Work</p>
                <ol className="text-xs text-foreground-secondary space-y-2">
                  <li className="flex gap-2">
                    <span className="text-accent font-bold">1.</span>
                    A statement is drawn from the encrypted pool
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent font-bold">2.</span>
                    Members vote agree or disagree privately
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent font-bold">3.</span>
                    After duration ends, results are tallied automatically
                  </li>
                  <li className="flex gap-2">
                    <span className="text-accent font-bold">4.</span>
                    Next duel begins automatically with a new statement
                  </li>
                </ol>
              </div>
            </div>
          </WizardStep>
        );

      case 'statements':
        return (
          <WizardStep title="Initial Statements" description="Add statements for the encrypted pool.">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.newStatement}
                    onChange={(e) => updateConfig({ newStatement: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addStatement()}
                    placeholder="Type a statement..."
                    maxLength={1000}
                    className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
                  />
                  <button
                    onClick={addStatement}
                    disabled={!config.newStatement.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs text-foreground-muted">
                  <span>{config.newStatement.length}/1000 characters</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-accent hover:text-accent-hover transition-colors"
                  >
                    Or upload CSV file
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleCsvUpload}
                    className="hidden"
                  />
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {config.statements.length === 0 ? (
                  <p className="text-sm text-foreground-muted text-center py-8">
                    No statements yet. Add at least one to continue.
                  </p>
                ) : (
                  config.statements.map((statement, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 bg-background-secondary rounded-md px-3 py-2 group"
                    >
                      <span className="text-xs text-foreground-muted font-mono mt-0.5 shrink-0 w-5 text-right">
                        {i + 1}
                      </span>
                      <p className="text-sm text-foreground flex-1 break-words">{statement}</p>
                      <button
                        onClick={() => removeStatement(i)}
                        className="text-foreground-muted hover:text-status-error transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

              {config.statements.length > 0 && (
                <p className="text-xs text-foreground-muted">
                  {config.statements.length} statement{config.statements.length !== 1 ? 's' : ''} added
                </p>
              )}
            </div>
          </WizardStep>
        );

      case 'review':
        return (
          <WizardStep title="Review & Create" description="Confirm your community settings.">
            <div className="space-y-3">
              {/* Cloak info */}
              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-sm font-medium text-foreground-muted mb-1">Community</h3>
                <p className="text-lg font-bold text-foreground">{config.name}</p>
                {config.description && (
                  <p className="text-sm text-foreground-secondary mt-1">{config.description}</p>
                )}
              </div>

              {/* Timing */}
              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-sm font-medium text-foreground-muted mb-1">Timing</h3>
                <p className="text-sm text-foreground">
                  Duration: {blocksToHumanTime(config.duelDuration, avgBlockTime)} ({config.duelDuration.toLocaleString()} blocks)
                </p>
                {config.firstDuelDate ? (
                  <p className="text-sm text-foreground-secondary mt-1">
                    First duel: {config.firstDuelDate} {config.firstDuelTime || ''}
                  </p>
                ) : (
                  <p className="text-sm text-foreground-secondary mt-1">
                    Duels start immediately after creation
                  </p>
                )}
              </div>

              {/* Statements */}
              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-sm font-medium text-foreground-muted mb-1">Statements</h3>
                <p className="text-sm text-foreground mb-2">
                  {config.statements.length} statement{config.statements.length !== 1 ? 's' : ''}
                </p>
                <ul className="space-y-1">
                  {config.statements.slice(0, 5).map((s, i) => (
                    <li key={i} className="text-xs text-foreground-secondary truncate">
                      {i + 1}. {s}
                    </li>
                  ))}
                  {config.statements.length > 5 && (
                    <li className="text-xs text-foreground-muted">
                      ...and {config.statements.length - 5} more
                    </li>
                  )}
                </ul>
              </div>

              {/* Privacy */}
              <div className="bg-status-error/8 border border-status-error/20 rounded-md p-3">
                <p className="text-sm text-foreground">
                  <span className="font-medium">Privacy:</span> Only voting results are shared publicly. Individual votes are never revealed.
                </p>
              </div>

              {/* Creation info */}
              <div className="bg-background-secondary border border-border rounded-md p-3">
                <p className="text-xs text-foreground-secondary">
                  Creating this community will privately submit{' '}
                  {config.statements.length} encrypted statement{config.statements.length !== 1 ? 's' : ''}{' '}
                  to the statement pool.
                </p>
              </div>
            </div>
          </WizardStep>
        );

      default:
        return null;
    }
  };

  return (
    <BaseWizard<StepId>
      steps={STEPS}
      currentStepIndex={wizard.currentStepIndex}
      direction={wizard.direction}
      progress={wizard.progress}
      isFirstStep={wizard.isFirstStep}
      isLastStep={wizard.isLastStep}
      isSubmitting={wizard.isSubmitting}
      validationError={wizard.validationError}
      submitError={wizard.submitError}
      hasDraft={wizard.hasDraft}
      goNext={wizard.goNext}
      goBack={wizard.goBack}
      goToStep={wizard.goToStep}
      submit={wizard.submit}
      loadDraft={wizard.loadDraft}
      clearDraft={wizard.clearDraft}
      submitLabel="Create Community"
    >
      {renderStep()}
    </BaseWizard>
  );
}
