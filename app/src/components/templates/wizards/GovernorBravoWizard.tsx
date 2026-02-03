'use client';

import React from 'react';
import { BaseWizard } from './BaseWizard';
import { CloakNameInput } from './CloakNameInput';
import { WizardStep } from './WizardStep';
import { useWizard, type WizardStep as WizardStepType } from '@/lib/hooks/useWizard';
import { MembershipMethodStep } from './steps/MembershipMethodStep';
import { TokenDistributionTable } from './steps/TokenDistributionTable';
import { MultisigTreasuryStep } from './steps/MultisigTreasuryStep';
import { CouncilSetupStep } from './steps/CouncilSetupStep';
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
  councilMembers: string[];
  councilThreshold: number;
  emergencyThreshold: number;
  isPubliclySearchable: boolean;
  isPubliclyViewable: boolean;
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
        if (c.councilThreshold > validMembers.length) return 'Threshold cannot exceed member count';
        if (c.emergencyThreshold > validMembers.length) return 'Emergency threshold cannot exceed member count';
      }
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
  const { account } = useWalletContext();
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
    councilMembers: [''],
    councilThreshold: 1,
    emergencyThreshold: 1,
    isPubliclySearchable: true,
    isPubliclyViewable: true, // Protocol governance must be publicly viewable
  };

  const wizard = useWizard<StepId, GovernorBravoConfig>({
    steps: STEPS,
    initialConfig,
    storageKey: 'governor-bravo-draft',
    onComplete: onSubmit,
  });

  const votingDelayDays = Math.round(wizard.config.votingDelay / (24 * 60 * 10));
  const votingPeriodDays = Math.round(wizard.config.votingPeriod / (24 * 60 * 10));
  const timelockDays = Math.round(wizard.config.timelockDelay / (24 * 60 * 10));
  const proposalThresholdK = Number(wizard.config.proposalThreshold / BigInt(1e18)) / 1000;
  const quorumK = Number(wizard.config.quorumVotes / BigInt(1e18)) / 1000;

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
          <div className="space-y-4">
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

            {/* Visibility Settings */}
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-foreground-secondary">Visibility</p>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wizard.config.isPubliclyViewable}
                  disabled
                  className="rounded opacity-60"
                />
                <span className="text-sm text-foreground-secondary">
                  Publicly viewable
                  <span className="text-xs text-foreground-muted ml-1">(required for protocol governance)</span>
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

            <div className="p-4 bg-background-secondary border border-border rounded-md">
              <p className="text-sm text-foreground-secondary">
                <strong>Governor Bravo</strong> is the industry-standard governance pattern used by
                Compound, Uniswap, and many other protocols. It includes delegation, timelock
                execution, and transparent operations while keeping votes private.
              </p>
            </div>
          </div>
        </WizardStep>
      )}

      {wizard.currentStep === 'membership' && (
        <WizardStep title="Token Gating" description="Protocol Governance uses token-only membership — no admin invite or email domain.">
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
          description="Optionally add a security council that can emergency-execute or cancel malicious proposals."
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
                  A small group of trusted addresses that can cancel or emergency-execute proposals.
                </p>
              </div>
            </label>

            {wizard.config.councilEnabled && (
              <CouncilSetupStep
                cloakMode={2}
                members={wizard.config.councilMembers}
                threshold={wizard.config.councilThreshold}
                emergencyThreshold={wizard.config.emergencyThreshold}
                onMembersChange={(councilMembers) => wizard.updateConfig({ councilMembers } as any)}
                onThresholdChange={(councilThreshold) => wizard.updateConfig({ councilThreshold } as any)}
                onEmergencyThresholdChange={(emergencyThreshold) => wizard.updateConfig({ emergencyThreshold } as any)}
              />
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
              <div className="flex items-center gap-2 text-sm text-foreground-secondary">
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

            {wizard.config.councilEnabled && (
              <div className="p-4 bg-background-secondary rounded-md">
                <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                  Security Council
                </h3>
                {wizard.config.councilMembers.filter((m) => m.trim()).length > 0 ? (
                  <>
                    <p className="text-foreground">
                      {wizard.config.councilMembers.filter((m) => m.trim()).length} members, {wizard.config.councilThreshold}-of-{wizard.config.councilMembers.filter((m) => m.trim()).length} threshold
                    </p>
                    <p className="text-foreground-secondary text-sm">
                      Emergency threshold: {wizard.config.emergencyThreshold}-of-{wizard.config.councilMembers.filter((m) => m.trim()).length}
                    </p>
                  </>
                ) : (
                  <p className="text-foreground-secondary text-sm">
                    No initial members — council members will be added later via governance proposals
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
              <p className="text-template-emerald">Transparent (Governor Bravo standard)</p>
              <p className="text-template-emerald text-sm">Vote choices are always private</p>
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
