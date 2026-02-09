'use client';

import React, { useCallback } from 'react';
import { BaseWizard } from './BaseWizard';
import { CloakNameInput } from './CloakNameInput';
import { WizardStep } from './WizardStep';
import { useWizard, type WizardStep as WizardStepType } from '@/lib/hooks/useWizard';
import { MembershipMethodStep } from './steps/MembershipMethodStep';
import { TokenDistributionTable } from './steps/TokenDistributionTable';
import { MultisigTreasuryStep } from './steps/MultisigTreasuryStep';
import type { TokenGateConfig } from '@/types/tokenGate';
import { DEFAULT_TOKEN_GATE_CONFIG, DEFAULT_AZTEC_TOKEN_CONFIG } from '@/types/tokenGate';
import { useAztecStore } from '@/store/aztecStore';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { nameToSlug } from '@/lib/utils/slug';

type StepId = 'basics' | 'membership' | 'council' | 'governance' | 'timelock' | 'review';

interface GovernorBravoConfig {
  name: string;
  description: string;
  timelockDelay: number;
  votingDelay: number;
  votingPeriod: number;
  proposalThreshold: bigint;
  quorumVotes: bigint;
  tokenGate?: TokenGateConfig;
  cloakMode: 0 | 2;
  councilEnabled: boolean;
  councilCount: number; // Total seats (including reserved)
  councilMembers: string[];
  councilThreshold: number;
  emergencyThreshold: number;
  visibility: 'open' | 'closed';
}

const STEPS: WizardStepType<StepId>[] = [
  {
    id: 'basics',
    label: 'Basics',
    validate: (config) => {
      const c = config as GovernorBravoConfig;
      if (!c.name?.trim()) return 'Governor name is required';
      if (c.name.length > 31) return 'Name must be 31 characters or less';
      const slug = nameToSlug(c.name);
      if (!slug) return 'Name must contain at least one letter or number';
      if (useAztecStore.getState().isSlugTaken(slug)) return 'A Cloak with this name already exists. Please choose a unique name.';
      return null;
    },
  },
  {
    id: 'membership',
    label: 'Membership',
    description: 'Membership method',
  },
  {
    id: 'council',
    label: 'Security Council',
    description: 'Optional security council',
    validate: (config) => {
      const c = config as GovernorBravoConfig;
      if (!c.councilEnabled) return null;
      const validMembers = c.councilMembers.filter((m) => m.trim().length > 0);
      if (validMembers.length > 0) {
        if (new Set(validMembers).size < validMembers.length) return 'Duplicate addresses found';
      }
      if (c.councilThreshold > c.councilCount) return 'Threshold cannot exceed council size';
      if (c.emergencyThreshold > c.councilCount) return 'Emergency threshold cannot exceed council size';
      if (c.councilThreshold < 1) return 'Threshold must be at least 1';
      if (c.emergencyThreshold < 1) return 'Emergency threshold must be at least 1';
      return null;
    },
  },
  {
    id: 'governance',
    label: 'Governance',
    validate: (config) => {
      const c = config as GovernorBravoConfig;
      if (c.votingPeriod < 14400) return 'Voting period must be at least 1 day';
      return null;
    },
  },
  {
    id: 'timelock',
    label: 'Timelock',
    validate: (config) => {
      const c = config as GovernorBravoConfig;
      if (c.timelockDelay < 14400) return 'Timelock delay must be at least 1 day';
      return null;
    },
  },
  { id: 'review', label: 'Review' },
];

interface GovernorBravoWizardProps {
  onSubmit: (config: GovernorBravoConfig) => Promise<void>;
}

export function GovernorBravoWizard({ onSubmit }: GovernorBravoWizardProps) {
  const { account, client } = useWalletContext();
  const creatorAddress = account?.address ?? '';
  const initialConfig: GovernorBravoConfig = {
    name: '',
    description: '',
    timelockDelay: 28800, // ~2 days
    votingDelay: 14400, // ~1 day
    votingPeriod: 100800, // ~7 days
    proposalThreshold: BigInt('100000000000000000000000'), // 100k tokens
    quorumVotes: BigInt('400000000000000000000000'), // 400k tokens
    tokenGate: { ...DEFAULT_TOKEN_GATE_CONFIG, method: 'aztec-token', aztecToken: { ...DEFAULT_AZTEC_TOKEN_CONFIG } } as TokenGateConfig,
    cloakMode: 0,
    councilEnabled: false,
    councilCount: 3,
    councilMembers: [''],
    councilThreshold: 2,
    emergencyThreshold: 3,
    visibility: 'open',
  };

  // Handle step changes to trigger pre-warming optimizations
  const handleStepChange = useCallback((step: StepId, config: GovernorBravoConfig, direction: 'forward' | 'back') => {
    if (step === 'review' && direction === 'forward') {
      // Entering review step — pre-warm artifacts only (deployment preparation disabled for debugging)
      import('@/lib/deployment').then(({ prewarmDeploymentArtifacts }) => {
        // Pre-warm all deployment artifacts
        prewarmDeploymentArtifacts().catch((err) => {
          console.warn('[GovernorBravoWizard] Artifact pre-warming failed (non-fatal):', err);
        });

        // NOTE: prepareDeployment disabled - was causing "Failed to get a note" errors
        // The deployment will build the transaction from scratch instead
      }).catch(() => {
        // Non-fatal — pre-warming is an optimization
      });
    }
    // NOTE: invalidatePreparedDeployment not needed since we're not preparing
  }, []);

  const wizard = useWizard<StepId, GovernorBravoConfig>({
    steps: STEPS,
    initialConfig,
    storageKey: 'governor-bravo-draft',
    onComplete: onSubmit,
    onStepChange: handleStepChange,
  });

  const votingDelayDays = Math.round(wizard.config.votingDelay / (24 * 60 * 10));
  const votingPeriodDays = Math.round(wizard.config.votingPeriod / (24 * 60 * 10));
  const timelockDays = Math.round(wizard.config.timelockDelay / (24 * 60 * 10));
  const proposalThresholdK = Number(wizard.config.proposalThreshold / BigInt(1e18)) / 1000;
  const quorumK = Number(wizard.config.quorumVotes / BigInt(1e18)) / 1000;
  const validMemberCount = wizard.config.councilMembers.filter((m) => m.trim().length > 0).length;

  // Helper to update council member
  const updateMember = (index: number, value: string) => {
    const updated = [...wizard.config.councilMembers];
    updated[index] = value;
    wizard.updateConfig({ councilMembers: updated } as any);
  };

  const addMember = () => {
    if (wizard.config.councilMembers.length < wizard.config.councilCount) {
      wizard.updateConfig({ councilMembers: [...wizard.config.councilMembers, ''] } as any);
    }
  };

  const removeMember = (index: number) => {
    const updated = wizard.config.councilMembers.filter((_, i) => i !== index);
    wizard.updateConfig({ councilMembers: updated.length === 0 ? [''] : updated } as any);
  };

  return (
    <BaseWizard
      steps={wizard.steps}
      currentStepIndex={wizard.currentStepIndex}
      progress={wizard.progress}
      isFirstStep={wizard.isFirstStep}
      isLastStep={wizard.isLastStep}
      isSubmitting={wizard.isSubmitting}
      validationError={wizard.validationError}
      submitError={wizard.submitError}
      hasDraft={wizard.hasDraft}
      goToStep={wizard.goToStep}
      goNext={wizard.goNext}
      goBack={wizard.goBack}
      submit={wizard.submit}
      loadDraft={wizard.loadDraft}
      clearDraft={wizard.clearDraft}
      submitLabel="Create Governor"
      cancelPath="/create"
    >
      {wizard.currentStep === 'basics' && (
        <WizardStep title="Governor Details" description="Basic information about your governance">
          <div className="space-y-6">
            <CloakNameInput
              value={wizard.config.name}
              onChange={(name) => wizard.updateConfig({ name })}
              placeholder="e.g., Protocol Governance"
            />

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
              <textarea
                value={wizard.config.description}
                onChange={(e) => wizard.updateConfig({ description: e.target.value })}
                placeholder="Describe the purpose of this governance..."
                rows={3}
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>

            {/* Privacy Info */}
            <div className="p-4 bg-template-emerald/10 border border-template-emerald/20 rounded-md">
              <h4 className="font-medium text-template-emerald mb-2">Always Private</h4>
              <ul className="text-sm text-template-emerald space-y-1">
                <li>- All votes (who votes and how they vote)</li>
                <li>- Delegation (who delegates to whom)</li>
                <li>- Proposal creation (who creates proposals)</li>
              </ul>
            </div>

            {/* Visibility Settings */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground-secondary">Visibility</p>
                <span className="text-xs text-foreground-muted">(can be changed via governance vote)</span>
              </div>

              <div className="space-y-2">
                <label
                  className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                    wizard.config.visibility === 'open'
                      ? 'border-template-emerald bg-template-emerald/10'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    checked={wizard.config.visibility === 'open'}
                    onChange={() => wizard.updateConfig({ visibility: 'open' } as any)}
                    className="mt-1 w-4 h-4 text-template-emerald border-gray-300 focus:ring-template-emerald focus:ring-offset-0"
                  />
                  <div>
                    <p className="font-medium text-foreground">Open</p>
                    <p className="text-sm text-foreground-muted">
                      Anyone can view the cloak dashboard, proposals, and vote results.
                      Only token holders can participate (vote, propose, delegate).
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                    wizard.config.visibility === 'closed'
                      ? 'border-template-emerald bg-template-emerald/10'
                      : 'border-border hover:border-border-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    checked={wizard.config.visibility === 'closed'}
                    onChange={() => wizard.updateConfig({ visibility: 'closed' } as any)}
                    className="mt-1 w-4 h-4 text-template-emerald border-gray-300 focus:ring-template-emerald focus:ring-offset-0"
                  />
                  <div>
                    <p className="font-medium text-foreground">Closed</p>
                    <p className="text-sm text-foreground-muted">
                      Only token holders can view the cloak dashboard, proposals, and vote results.
                      All activity is private to members.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'membership' && (
        <WizardStep title="Token Gating" description="Protocol Governance uses token-only membership">
          <MembershipMethodStep
            config={wizard.config.tokenGate ?? { ...DEFAULT_TOKEN_GATE_CONFIG, method: 'aztec-token' }}
            onChange={(tokenGate) => wizard.updateConfig({ tokenGate } as any)}
            allowedMethods={['aztec-token', 'erc20-token']}
          />
          {wizard.config.tokenGate?.method === 'aztec-token' &&
           wizard.config.tokenGate?.aztecToken?.mode === 'create-new' && (
            <div className="mt-6 space-y-6">
              <TokenDistributionTable
                rows={wizard.config.tokenGate.aztecToken.initialDistribution ?? [{ address: '', amount: '1000000' }]}
                onChange={(rows) => {
                  const tokenGate = { ...wizard.config.tokenGate! };
                  tokenGate.aztecToken = { ...tokenGate.aztecToken!, initialDistribution: rows };
                  wizard.updateConfig({ tokenGate } as any);
                }}
                creatorAddress={creatorAddress}
              />
              <MultisigTreasuryStep
                config={wizard.config.tokenGate.aztecToken.multisigTreasury ?? {
                  enabled: false, amount: '0', signers: [''], threshold: 1,
                }}
                onChange={(multisigTreasury) => {
                  const tokenGate = { ...wizard.config.tokenGate! };
                  tokenGate.aztecToken = { ...tokenGate.aztecToken!, multisigTreasury };
                  wizard.updateConfig({ tokenGate } as any);
                }}
              />
            </div>
          )}
        </WizardStep>
      )}

      {wizard.currentStep === 'council' && (
        <WizardStep
          title="Security Council"
          description="Optional council for emergency actions and proposal oversight"
        >
          <div className="space-y-6">
            <label className="flex items-center gap-3 p-4 border border-border rounded-lg cursor-pointer hover:border-border-hover transition-colors">
              <input
                type="checkbox"
                checked={wizard.config.councilEnabled}
                onChange={(e) => wizard.updateConfig({ councilEnabled: e.target.checked, cloakMode: e.target.checked ? 2 : 0 } as any)}
                className="rounded"
              />
              <div>
                <p className="font-medium text-foreground">Enable Security Council</p>
                <p className="text-sm text-foreground-muted">
                  A small group of trusted addresses with emergency powers.
                </p>
              </div>
            </label>

            {wizard.config.councilEnabled && (
              <div className="space-y-6">
                {/* Council Size */}
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Council Size: {wizard.config.councilCount} seats
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={wizard.config.councilCount}
                    onChange={(e) => {
                      const newCount = parseInt(e.target.value);
                      wizard.updateConfig({
                        councilCount: newCount,
                        councilThreshold: Math.min(wizard.config.councilThreshold, newCount),
                        emergencyThreshold: Math.min(wizard.config.emergencyThreshold, newCount),
                      } as any);
                    }}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-foreground-muted">
                    <span>1</span>
                    <span>6</span>
                    <span>12</span>
                  </div>
                  <p className="text-xs text-foreground-muted mt-1">
                    Total council seats. Empty seats can be filled later via governance vote.
                  </p>
                </div>

                {/* Council Members */}
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-2">
                    Council Members ({validMemberCount}/{wizard.config.councilCount} seats filled)
                  </label>
                  <div className="space-y-2">
                    {wizard.config.councilMembers.map((member, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={member}
                          onChange={(e) => updateMember(i, e.target.value)}
                          placeholder={`Seat ${i + 1} - Aztec address (0x...)`}
                          className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring font-mono text-sm"
                        />
                        {wizard.config.councilMembers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeMember(i)}
                            className="px-3 py-2 text-status-error hover:bg-status-error/10 rounded-md transition-colors"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {wizard.config.councilMembers.length < wizard.config.councilCount && (
                    <button
                      type="button"
                      onClick={addMember}
                      className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors"
                    >
                      + Add member
                    </button>
                  )}
                  <p className="text-xs text-foreground-muted mt-2">
                    Leave seats empty to fill them later via governance proposals.
                  </p>
                </div>

                {/* Council Threshold */}
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Cancel Threshold: {wizard.config.councilThreshold} of {wizard.config.councilCount}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={wizard.config.councilCount}
                    value={wizard.config.councilThreshold}
                    onChange={(e) => wizard.updateConfig({ councilThreshold: parseInt(e.target.value) } as any)}
                    className="w-full"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Council members required to cancel malicious proposals
                  </p>
                </div>

                {/* Emergency Threshold */}
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">
                    Emergency Threshold: {wizard.config.emergencyThreshold} of {wizard.config.councilCount}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={wizard.config.councilCount}
                    value={wizard.config.emergencyThreshold}
                    onChange={(e) => wizard.updateConfig({ emergencyThreshold: parseInt(e.target.value) } as any)}
                    className="w-full"
                  />
                  <p className="text-xs text-foreground-muted mt-1">
                    Council members required to bypass timelock (emergency execution)
                  </p>
                </div>

                {/* Info Box */}
                <div className="p-4 bg-status-warning/10 border border-status-warning/20 rounded-md">
                  <p className="text-sm text-status-warning">
                    <strong>Tip:</strong> Set a higher emergency threshold than cancel threshold.
                    Emergency execution bypasses the timelock, so it should require more agreement.
                  </p>
                </div>
              </div>
            )}
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'governance' && (
        <WizardStep title="Governance Parameters" description="Configure voting rules">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Voting Delay: {votingDelayDays} day{votingDelayDays !== 1 ? 's' : ''}
              </label>
              <input
                type="range"
                min={0}
                max={72000}
                step={14400}
                value={wizard.config.votingDelay}
                onChange={(e) => wizard.updateConfig({ votingDelay: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>None</span>
                <span>2 days</span>
                <span>5 days</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Time between proposal creation and voting start
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Voting Period: {votingPeriodDays} days
              </label>
              <input
                type="range"
                min={14400}
                max={302400}
                step={14400}
                value={wizard.config.votingPeriod}
                onChange={(e) => wizard.updateConfig({ votingPeriod: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>1 day</span>
                <span>7 days</span>
                <span>21 days</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Proposal Threshold: {proposalThresholdK}k tokens
              </label>
              <input
                type="range"
                min={1000}
                max={1000000}
                step={1000}
                value={proposalThresholdK * 1000}
                onChange={(e) =>
                  wizard.updateConfig({
                    proposalThreshold: BigInt(parseInt(e.target.value)) * BigInt(1e18),
                  })
                }
                className="w-full"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Minimum tokens required to create a proposal
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Quorum: {quorumK}k tokens
              </label>
              <input
                type="range"
                min={10000}
                max={10000000}
                step={10000}
                value={quorumK * 1000}
                onChange={(e) =>
                  wizard.updateConfig({
                    quorumVotes: BigInt(parseInt(e.target.value)) * BigInt(1e18),
                  })
                }
                className="w-full"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Minimum voting power for a proposal to pass
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'timelock' && (
        <WizardStep title="Timelock Settings" description="Configure execution delay">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Timelock Delay: {timelockDays} days
              </label>
              <input
                type="range"
                min={14400}
                max={144000}
                step={14400}
                value={wizard.config.timelockDelay}
                onChange={(e) => wizard.updateConfig({ timelockDelay: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>1 day</span>
                <span>5 days</span>
                <span>10 days</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Time between proposal passing and execution
              </p>
            </div>

            <div className="p-4 bg-background-secondary border border-border rounded-md">
              <h4 className="font-medium text-foreground mb-2">Proposal Lifecycle</h4>
              <div className="flex items-center gap-2 text-sm text-foreground-secondary flex-wrap">
                <span className="px-2 py-1 bg-background-tertiary rounded">Created</span>
                <span>→</span>
                <span className="px-2 py-1 bg-status-info/10 text-status-info rounded">
                  {votingDelayDays}d delay
                </span>
                <span>→</span>
                <span className="px-2 py-1 bg-accent-muted text-accent rounded">
                  {votingPeriodDays}d voting
                </span>
                <span>→</span>
                <span className="px-2 py-1 bg-template-amber/10 text-template-amber rounded">
                  {timelockDays}d timelock
                </span>
                <span>→</span>
                <span className="px-2 py-1 bg-template-emerald/10 text-template-emerald rounded">Execute</span>
              </div>
            </div>

            <div className="p-4 bg-status-warning/10 border border-status-warning/20 rounded-md">
              <p className="text-sm text-status-warning">
                {wizard.config.councilEnabled
                  ? 'The timelock gives token holders time to exit. The security council can emergency-execute to bypass it if needed.'
                  : 'The timelock gives token holders time to exit if they disagree with a passed proposal before it executes.'}
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'review' && (
        <WizardStep title="Review & Create" description="Confirm your governance settings">
          <div className="space-y-4">
            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Governor
              </h3>
              <p className="font-semibold text-foreground">{wizard.config.name || '(No name)'}</p>
              {wizard.config.description && (
                <p className="text-foreground-secondary mt-1">{wizard.config.description}</p>
              )}
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Visibility
              </h3>
              <p className="text-foreground font-medium">
                {wizard.config.visibility === 'open' ? 'Open' : 'Closed'}
              </p>
              <p className="text-foreground-secondary text-sm">
                {wizard.config.visibility === 'open'
                  ? 'Anyone can view; only token holders can participate'
                  : 'Only token holders can view and participate'}
              </p>
            </div>

            {wizard.config.councilEnabled && (
              <div className="p-4 bg-background-secondary rounded-md">
                <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                  Security Council
                </h3>
                <p className="text-foreground">
                  {wizard.config.councilCount} seats ({validMemberCount} filled, {wizard.config.councilCount - validMemberCount} reserved)
                </p>
                <p className="text-foreground-secondary text-sm">
                  Cancel threshold: {wizard.config.councilThreshold}-of-{wizard.config.councilCount}
                </p>
                <p className="text-foreground-secondary text-sm">
                  Emergency threshold: {wizard.config.emergencyThreshold}-of-{wizard.config.councilCount}
                </p>
                {validMemberCount < wizard.config.councilCount && (
                  <p className="text-foreground-muted text-xs mt-1">
                    Empty seats will be filled via governance proposals
                  </p>
                )}
              </div>
            )}

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Governance
              </h3>
              <p className="text-foreground">Voting delay: {votingDelayDays} days</p>
              <p className="text-foreground-secondary text-sm">Voting period: {votingPeriodDays} days</p>
              <p className="text-foreground-secondary text-sm">Proposal threshold: {proposalThresholdK}k tokens</p>
              <p className="text-foreground-secondary text-sm">Quorum: {quorumK}k tokens</p>
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Timelock
              </h3>
              <p className="text-foreground">Execution delay: {timelockDays} days</p>
            </div>

            {wizard.config.tokenGate && (wizard.config.tokenGate.method === 'aztec-token' || wizard.config.tokenGate.method === 'erc20-token') && (
              <div className="p-4 bg-background-secondary rounded-md">
                <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                  Token Gating
                </h3>
                {wizard.config.tokenGate.method === 'aztec-token' && wizard.config.tokenGate.aztecToken && (
                  <>
                    <p className="text-foreground">
                      {wizard.config.tokenGate.aztecToken.mode === 'create-new'
                        ? `New Token: ${wizard.config.tokenGate.aztecToken.newTokenName} (${wizard.config.tokenGate.aztecToken.newTokenSymbol})`
                        : `Existing Token: ${wizard.config.tokenGate.aztecToken.existingTokenAddress?.slice(0, 10)}...`}
                    </p>
                    <p className="text-foreground-secondary text-sm">
                      Min balance to join: {wizard.config.tokenGate.aztecToken.minMembershipBalance} |
                      Min to propose: {wizard.config.tokenGate.aztecToken.minProposerBalance}
                    </p>
                    {wizard.config.tokenGate.aztecToken.multisigTreasury?.enabled && (
                      <p className="text-foreground-secondary text-sm">
                        Multisig treasury: {wizard.config.tokenGate.aztecToken.multisigTreasury.amount} tokens,{' '}
                        {wizard.config.tokenGate.aztecToken.multisigTreasury.threshold}-of-
                        {wizard.config.tokenGate.aztecToken.multisigTreasury.signers.length} signers
                      </p>
                    )}
                  </>
                )}
                {wizard.config.tokenGate.method === 'erc20-token' && wizard.config.tokenGate.erc20Token && (
                  <>
                    <p className="text-foreground">
                      ERC20: {wizard.config.tokenGate.erc20Token.tokenAddress.slice(0, 10)}...
                    </p>
                    <p className="text-foreground-secondary text-sm">
                      Chain: {wizard.config.tokenGate.erc20Token.chainId === 1 ? 'Mainnet' : wizard.config.tokenGate.erc20Token.chainId === 8453 ? 'Base' : 'Sepolia'} |
                      Min balance: {wizard.config.tokenGate.erc20Token.minMembershipBalance}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="p-4 bg-template-emerald/10 rounded-md">
              <h3 className="text-sm font-medium text-template-emerald uppercase tracking-wide mb-2">
                Privacy
              </h3>
              <ul className="text-sm text-template-emerald space-y-1">
                <li>- Votes are always private (who voted, how they voted)</li>
                <li>- Delegation is always private</li>
                <li>- Proposal creators are always private</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 p-4 bg-status-info/10 border border-status-info/20 rounded-md">
            <p className="text-sm text-status-info">
              Creating this Cloak will deploy a smart contract. Visibility can be changed later via a governance vote.
            </p>
          </div>
        </WizardStep>
      )}
    </BaseWizard>
  );
}
