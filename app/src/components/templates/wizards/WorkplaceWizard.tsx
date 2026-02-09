'use client';

import React from 'react';
import { BaseWizard } from './BaseWizard';
import { CloakNameInput } from './CloakNameInput';
import { WizardStep } from './WizardStep';
import { useWizard, type WizardStep as WizardStepType } from '@/lib/hooks/useWizard';
import type { WorkplaceCloakConfig } from '@/lib/templates/WorkplaceCloakService';
import { MembershipMethodStep } from './steps/MembershipMethodStep';
import { TokenDistributionTable } from './steps/TokenDistributionTable';
import { MultisigTreasuryStep } from './steps/MultisigTreasuryStep';
import type { TokenGateConfig } from '@/types/tokenGate';
import { DEFAULT_TOKEN_GATE_CONFIG, DEFAULT_AZTEC_TOKEN_CONFIG } from '@/types/tokenGate';
import { useAztecStore } from '@/store/aztecStore';
import { nameToSlug } from '@/lib/utils/slug';

type StepId = 'basics' | 'membership' | 'privacy' | 'governance' | 'review';

const STEPS: WizardStepType<StepId>[] = [
  {
    id: 'basics',
    label: 'Basics',
    validate: (config) => {
      const c = config as WorkplaceCloakConfig;
      if (!c.name?.trim()) return 'Organization name is required';
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
  { id: 'privacy', label: 'Privacy' },
  {
    id: 'governance',
    label: 'Governance',
    validate: (config) => {
      const c = config as WorkplaceCloakConfig;
      if (c.quorumThreshold < 1) return 'Quorum must be at least 1';
      if (c.resultDelay < 0) return 'Result delay cannot be negative';
      return null;
    },
  },
  { id: 'review', label: 'Review' },
];

interface WorkplaceWizardProps {
  onSubmit: (config: WorkplaceCloakConfig) => Promise<void>;
}

export function WorkplaceWizard({ onSubmit }: WorkplaceWizardProps) {
  const initialConfig: WorkplaceCloakConfig = {
    name: '',
    description: '',
    votingDuration: 100800, // ~7 days
    quorumThreshold: 5,
    resultDelay: 14400, // ~1 day delay before results shown
    tokenGate: DEFAULT_TOKEN_GATE_CONFIG as TokenGateConfig,
    isPubliclyViewable: true,
  };

  const wizard = useWizard<StepId, WorkplaceCloakConfig>({
    steps: STEPS,
    initialConfig,
    storageKey: 'workplace-cloak-draft',
    onComplete: onSubmit,
  });

  const votingDays = Math.round(wizard.config.votingDuration / (24 * 60 * 10));
  const delayDays = Math.round(wizard.config.resultDelay / (24 * 60 * 10));

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
      submitLabel="Create Workplace Cloak"
      cancelPath="/create"
    >
      {wizard.currentStep === 'basics' && (
        <WizardStep
          title="Workplace Details"
          description="Basic information (kept confidential)"
        >
          <div className="space-y-4">
            <CloakNameInput
              value={wizard.config.name}
              onChange={(name) => wizard.updateConfig({ name })}
              placeholder="e.g., Workers United"
            />

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
              <textarea
                value={wizard.config.description}
                onChange={(e) => wizard.updateConfig({ description: e.target.value })}
                placeholder="Describe the purpose of this organization..."
                rows={3}
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>

            {/* Visibility Settings */}
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-foreground-secondary">Visibility</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wizard.config.isPubliclyViewable}
                  onChange={(e) => wizard.updateConfig({ isPubliclyViewable: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-foreground-secondary">
                  Publicly viewable
                  <span className="text-xs text-foreground-muted ml-1">(anyone can view at the Cloak URL)</span>
                </span>
              </label>
            </div>

            <div className="p-4 bg-template-rose/10 border border-status-error/20 rounded-md">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-template-rose flex-shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                <div>
                  <p className="font-medium text-template-rose">Maximum Privacy Enabled</p>
                  <p className="text-sm text-template-rose mt-1">
                    This template uses maximum privacy settings to protect workers. Member lists are
                    hidden, voting is anonymous, and results are delayed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'membership' && (
        <WizardStep title="Membership Method" description="How will members join?">
          <MembershipMethodStep
            config={wizard.config.tokenGate ?? DEFAULT_TOKEN_GATE_CONFIG}
            onChange={(tokenGate) => wizard.updateConfig({ tokenGate } as any)}
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

      {wizard.currentStep === 'privacy' && (
        <WizardStep title="Privacy Protection" description="Built-in protections for your safety">
          <div className="space-y-6">
            <div className="p-4 bg-template-rose/10 border border-status-error/20 rounded-md">
              <h4 className="font-medium text-template-rose mb-3">Maximum Privacy Features</h4>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Hidden member list - no one can see who is a member
                </li>
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Anonymous membership count (approximate only)
                </li>
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Anonymous voting with secret ballots
                </li>
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Results hidden until voting ends + delay period
                </li>
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  All proposals are anonymous by default
                </li>
                <li className="flex items-center gap-2 text-sm text-template-rose">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  No activity feed or join announcements
                </li>
              </ul>
            </div>

            <div className="p-4 bg-background-secondary border border-border rounded-md">
              <p className="text-sm text-foreground-secondary">
                <strong>Note:</strong> These privacy settings are locked and cannot be changed after
                creation. This ensures members who join are protected by the privacy guarantees
                they expected.
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'governance' && (
        <WizardStep title="Governance Settings" description="Configure voting parameters">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Voting Duration: {votingDays} days
              </label>
              <input
                type="range"
                min={14400}
                max={302400}
                step={14400}
                value={wizard.config.votingDuration}
                onChange={(e) => wizard.updateConfig({ votingDuration: parseInt(e.target.value) })}
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
                Result Delay: {delayDays} day{delayDays !== 1 ? 's' : ''}
              </label>
              <input
                type="range"
                min={0}
                max={72000}
                step={14400}
                value={wizard.config.resultDelay}
                onChange={(e) => wizard.updateConfig({ resultDelay: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>None</span>
                <span>2 days</span>
                <span>5 days</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Time after voting ends before results are revealed
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Quorum Threshold
              </label>
              <input
                type="number"
                min={1}
                value={wizard.config.quorumThreshold}
                onChange={(e) =>
                  wizard.updateConfig({ quorumThreshold: parseInt(e.target.value) || 1 })
                }
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="text-xs text-foreground-muted mt-1">Minimum votes needed for a proposal to pass</p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'review' && (
        <WizardStep title="Review & Create" description="Confirm your settings">
          <div className="space-y-4">
            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Organization
              </h3>
              <p className="font-semibold text-foreground">{wizard.config.name || '(No name)'}</p>
              {wizard.config.description && (
                <p className="text-foreground-secondary mt-1">{wizard.config.description}</p>
              )}
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

            <div className="p-4 bg-template-rose/10 rounded-md">
              <h3 className="text-sm font-medium text-template-rose uppercase tracking-wide mb-2">
                Privacy
              </h3>
              <p className="text-template-rose font-medium">Maximum Privacy</p>
              <p className="text-template-rose text-sm">All privacy protections enabled</p>
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Governance
              </h3>
              <p className="text-foreground">Voting: {votingDays} days</p>
              <p className="text-foreground-secondary text-sm">Result delay: {delayDays} day{delayDays !== 1 ? 's' : ''}</p>
              <p className="text-foreground-secondary text-sm">Quorum: {wizard.config.quorumThreshold} votes</p>
            </div>
          </div>

          <div className="mt-4 p-4 bg-status-warning/10 border border-status-warning/20 rounded-md">
            <p className="text-sm text-status-warning">
              Creating this Cloak will deploy a smart contract. Privacy settings are locked permanently.
            </p>
          </div>
        </WizardStep>
      )}
    </BaseWizard>
  );
}
