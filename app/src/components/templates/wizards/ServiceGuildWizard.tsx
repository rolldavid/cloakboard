'use client';

import React from 'react';
import { BaseWizard } from './BaseWizard';
import { WizardStep } from './WizardStep';
import { PrivacySlider } from '@/components/privacy';
import { useWizard, type WizardStep as WizardStepType } from '@/lib/hooks/useWizard';
import type { PrivacyLevel } from '@/lib/constants/templates';
import { MembershipMethodStep } from './steps/MembershipMethodStep';
import { TokenDistributionTable } from './steps/TokenDistributionTable';
import { MultisigTreasuryStep } from './steps/MultisigTreasuryStep';
import type { TokenGateConfig } from '@/types/tokenGate';
import { DEFAULT_TOKEN_GATE_CONFIG, DEFAULT_AZTEC_TOKEN_CONFIG } from '@/types/tokenGate';
import { useAztecStore } from '@/store/aztecStore';
import { nameToSlug } from '@/lib/utils/slug';

type StepId = 'basics' | 'membership' | 'guild' | 'privacy' | 'governance' | 'review';

interface ServiceGuildConfig {
  name: string;
  description: string;
  guildFeePercent: number;
  minReputation: number;
  votingDuration: number;
  quorumThreshold: number;
  privacyPreset: 'maximum' | 'balanced' | 'transparent';
  tokenGate?: TokenGateConfig;

  // Visibility
  isPubliclyViewable: boolean;
}

const STEPS: WizardStepType<StepId>[] = [
  {
    id: 'basics',
    label: 'Basics',
    validate: (config) => {
      const c = config as ServiceGuildConfig;
      if (!c.name?.trim()) return 'Guild name is required';
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
    id: 'guild',
    label: 'Guild Rules',
    validate: (config) => {
      const c = config as ServiceGuildConfig;
      if (c.guildFeePercent < 0 || c.guildFeePercent > 50) return 'Fee must be 0-50%';
      return null;
    },
  },
  { id: 'privacy', label: 'Privacy' },
  {
    id: 'governance',
    label: 'Governance',
    validate: (config) => {
      const c = config as ServiceGuildConfig;
      if (c.quorumThreshold < 1) return 'Quorum must be at least 1';
      return null;
    },
  },
  { id: 'review', label: 'Review' },
];

interface ServiceGuildWizardProps {
  onSubmit: (config: ServiceGuildConfig) => Promise<void>;
}

export function ServiceGuildWizard({ onSubmit }: ServiceGuildWizardProps) {
  const initialConfig: ServiceGuildConfig = {
    name: '',
    description: '',
    guildFeePercent: 5,
    minReputation: 0,
    votingDuration: 72000, // ~5 days
    quorumThreshold: 3,
    privacyPreset: 'balanced',
    tokenGate: DEFAULT_TOKEN_GATE_CONFIG as TokenGateConfig,
    isPubliclyViewable: true,
  };

  const wizard = useWizard<StepId, ServiceGuildConfig>({
    steps: STEPS,
    initialConfig,
    storageKey: 'service-guild-draft',
    onComplete: onSubmit,
  });

  const votingDays = Math.round(wizard.config.votingDuration / (24 * 60 * 10));

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
      submitLabel="Create Service Guild"
      cancelPath="/create"
    >
      {wizard.currentStep === 'basics' && (
        <WizardStep title="Guild Details" description="Basic information about your service guild">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">Guild Name *</label>
              <input
                type="text"
                value={wizard.config.name}
                onChange={(e) => wizard.updateConfig({ name: e.target.value })}
                placeholder="e.g., Design Collective"
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                maxLength={31}
              />
              <p className="text-xs text-foreground-muted mt-1">
                {wizard.config.name.length}/31 characters
                {wizard.config.name.trim() && (
                  <> &middot; URL: /cloak/<strong>{nameToSlug(wizard.config.name)}</strong></>
                )}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
              <textarea
                value={wizard.config.description}
                onChange={(e) => wizard.updateConfig({ description: e.target.value })}
                placeholder="Describe the services your guild provides..."
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

      {wizard.currentStep === 'guild' && (
        <WizardStep title="Guild Rules" description="Configure guild operations">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Guild Fee: {wizard.config.guildFeePercent}%
              </label>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={wizard.config.guildFeePercent}
                onChange={(e) =>
                  wizard.updateConfig({ guildFeePercent: parseInt(e.target.value) })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Percentage of job payments that go to the guild treasury
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Minimum Reputation to Join
              </label>
              <input
                type="number"
                min={0}
                value={wizard.config.minReputation}
                onChange={(e) =>
                  wizard.updateConfig({ minReputation: parseInt(e.target.value) || 0 })
                }
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Set to 0 to allow anyone to join, or require reputation from prior work
              </p>
            </div>

            <div className="p-4 bg-template-amber/10 border border-template-amber/20 rounded-md">
              <h4 className="font-medium text-template-amber mb-2">Guild Features</h4>
              <ul className="text-sm text-template-amber space-y-1">
                <li>• Job board for posting and claiming work</li>
                <li>• Reputation system tracks completed jobs</li>
                <li>• Dispute resolution through governance</li>
                <li>• Guild fee funds shared treasury</li>
              </ul>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'privacy' && (
        <WizardStep
          title="Privacy Settings"
          description="Choose visibility of guild operations"
        >
          <PrivacySlider
            value={wizard.config.privacyPreset as PrivacyLevel}
            onChange={(value) => wizard.updateConfig({ privacyPreset: value })}
          />
        </WizardStep>
      )}

      {wizard.currentStep === 'governance' && (
        <WizardStep title="Governance Settings" description="Configure dispute resolution">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Voting Duration: {votingDays} days
              </label>
              <input
                type="range"
                min={14400}
                max={144000}
                step={14400}
                value={wizard.config.votingDuration}
                onChange={(e) => wizard.updateConfig({ votingDuration: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>1 day</span>
                <span>5 days</span>
                <span>10 days</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Time for members to vote on disputes and proposals
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
              <p className="text-xs text-foreground-muted mt-1">
                Minimum votes needed to resolve a dispute
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'review' && (
        <WizardStep title="Review & Create" description="Confirm your guild settings">
          <div className="space-y-4">
            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Guild
              </h3>
              <p className="font-semibold text-foreground">{wizard.config.name || '(No name)'}</p>
              {wizard.config.description && (
                <p className="text-foreground-secondary mt-1">{wizard.config.description}</p>
              )}
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Guild Rules
              </h3>
              <p className="text-foreground">Guild fee: {wizard.config.guildFeePercent}%</p>
              <p className="text-foreground-secondary text-sm">
                Min reputation: {wizard.config.minReputation || 'None'}
              </p>
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Privacy
              </h3>
              <p className="text-foreground capitalize">{wizard.config.privacyPreset}</p>
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

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Governance
              </h3>
              <p className="text-foreground">Voting: {votingDays} days</p>
              <p className="text-foreground-secondary text-sm">Quorum: {wizard.config.quorumThreshold} votes</p>
            </div>
          </div>

          <div className="mt-4 p-4 bg-status-warning/10 border border-status-warning/20 rounded-md">
            <p className="text-sm text-status-warning">
              Creating this Cloak will deploy a smart contract. This action cannot be undone.
            </p>
          </div>
        </WizardStep>
      )}
    </BaseWizard>
  );
}
