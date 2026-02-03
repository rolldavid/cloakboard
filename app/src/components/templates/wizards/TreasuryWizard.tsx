'use client';

import React from 'react';
import { BaseWizard } from './BaseWizard';
import { CloakNameInput } from './CloakNameInput';
import { WizardStep } from './WizardStep';
import { PrivacySlider } from '@/components/privacy';
import { useWizard, type WizardStep as WizardStepType } from '@/lib/hooks/useWizard';
import type { TreasuryCloakConfig } from '@/lib/templates/TreasuryCloakService';
import type { PrivacyLevel } from '@/lib/constants/templates';
import { MembershipMethodStep } from './steps/MembershipMethodStep';
import { TokenDistributionTable } from './steps/TokenDistributionTable';
import { MultisigTreasuryStep } from './steps/MultisigTreasuryStep';
import type { TokenGateConfig } from '@/types/tokenGate';
import { DEFAULT_TOKEN_GATE_CONFIG, DEFAULT_AZTEC_TOKEN_CONFIG } from '@/types/tokenGate';
import { useAztecStore } from '@/store/aztecStore';
import { nameToSlug } from '@/lib/utils/slug';

type StepId = 'basics' | 'membership' | 'multisig' | 'privacy' | 'governance' | 'review';

const STEPS: WizardStepType<StepId>[] = [
  {
    id: 'basics',
    label: 'Basics',
    validate: (config) => {
      const c = config as TreasuryCloakConfig;
      if (!c.name?.trim()) return 'Treasury name is required';
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
    id: 'multisig',
    label: 'Multi-Sig',
    validate: (config) => {
      const c = config as TreasuryCloakConfig;
      if (c.requiredSignatures < 1) return 'At least 1 signature required';
      return null;
    },
  },
  { id: 'privacy', label: 'Privacy' },
  {
    id: 'governance',
    label: 'Governance',
    validate: (config) => {
      const c = config as TreasuryCloakConfig;
      if (c.quorumThreshold < 1) return 'Quorum must be at least 1';
      return null;
    },
  },
  { id: 'review', label: 'Review' },
];

interface TreasuryWizardProps {
  onSubmit: (config: TreasuryCloakConfig) => Promise<void>;
}

export function TreasuryWizard({ onSubmit }: TreasuryWizardProps) {
  const initialConfig: TreasuryCloakConfig = {
    name: '',
    description: '',
    requiredSignatures: 2,
    multisigThreshold: BigInt('1000000000000000000'), // 1 ETH
    votingDuration: 100800,
    quorumThreshold: 5,
    privacyPreset: 'balanced',
    tokenGate: DEFAULT_TOKEN_GATE_CONFIG as TokenGateConfig,
    isPubliclySearchable: false,
    isPubliclyViewable: true,
  };

  const wizard = useWizard<StepId, TreasuryCloakConfig>({
    steps: STEPS,
    initialConfig,
    storageKey: 'treasury-cloak-draft',
    onComplete: onSubmit,
  });

  const votingDays = Math.round(wizard.config.votingDuration / (24 * 60 * 10));
  const thresholdEth = Number(wizard.config.multisigThreshold) / 1e18;

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
      submitLabel="Create Treasury Cloak"
      cancelPath="/create"
    >
      {wizard.currentStep === 'basics' && (
        <WizardStep title="Treasury Details" description="Basic information about your treasury">
          <div className="space-y-4">
            <CloakNameInput
              value={wizard.config.name}
              onChange={(name) => wizard.updateConfig({ name })}
              placeholder="e.g., Community Treasury"
            />

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
              <textarea
                value={wizard.config.description}
                onChange={(e) => wizard.updateConfig({ description: e.target.value })}
                placeholder="Describe the purpose of this treasury..."
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
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wizard.config.isPubliclySearchable}
                  onChange={(e) => wizard.updateConfig({ isPubliclySearchable: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-foreground-secondary">
                  Publicly searchable
                  <span className="text-xs text-foreground-muted ml-1">(appears in Explore page)</span>
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

      {wizard.currentStep === 'multisig' && (
        <WizardStep
          title="Multi-Signature Settings"
          description="Configure security for large transactions"
        >
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Required Signatures
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={wizard.config.requiredSignatures}
                onChange={(e) =>
                  wizard.updateConfig({ requiredSignatures: parseInt(e.target.value) || 1 })
                }
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Number of signers needed for large transactions
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Multi-Sig Threshold: {thresholdEth} ETH
              </label>
              <input
                type="range"
                min={0.1}
                max={100}
                step={0.1}
                value={thresholdEth}
                onChange={(e) =>
                  wizard.updateConfig({
                    multisigThreshold: BigInt(Math.floor(parseFloat(e.target.value) * 1e18)),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-foreground-muted">
                <span>0.1 ETH</span>
                <span>50 ETH</span>
                <span>100 ETH</span>
              </div>
              <p className="text-xs text-foreground-muted mt-1">
                Transactions above this amount require multi-sig approval
              </p>
            </div>

            <div className="p-4 bg-template-emerald/10 border border-status-success/20 rounded-md">
              <p className="text-sm text-template-emerald">
                Transactions under {thresholdEth} ETH can be executed with a single signature.
                Larger transactions require {wizard.config.requiredSignatures} signatures.
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'privacy' && (
        <WizardStep
          title="Privacy Settings"
          description="Choose visibility of treasury operations"
        >
          <PrivacySlider
            value={wizard.config.privacyPreset as PrivacyLevel}
            onChange={(value) => wizard.updateConfig({ privacyPreset: value })}
          />
        </WizardStep>
      )}

      {wizard.currentStep === 'governance' && (
        <WizardStep title="Governance Settings" description="Configure spending proposals">
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
                Minimum votes needed for spending proposals to pass
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'review' && (
        <WizardStep title="Review & Create" description="Confirm your treasury settings">
          <div className="space-y-4">
            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Treasury
              </h3>
              <p className="font-semibold text-foreground">{wizard.config.name || '(No name)'}</p>
              {wizard.config.description && (
                <p className="text-foreground-secondary mt-1">{wizard.config.description}</p>
              )}
            </div>

            <div className="p-4 bg-background-secondary rounded-md">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Multi-Sig
              </h3>
              <p className="text-foreground">{wizard.config.requiredSignatures} signatures required</p>
              <p className="text-foreground-secondary text-sm">Threshold: {thresholdEth} ETH</p>
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
                Privacy
              </h3>
              <p className="text-foreground capitalize">{wizard.config.privacyPreset}</p>
            </div>

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
