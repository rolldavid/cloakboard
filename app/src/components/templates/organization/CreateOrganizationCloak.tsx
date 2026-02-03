'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrganizationCloakConfig } from '@/lib/templates/OrganizationCloakService';

/**
 * Wizard step type
 */
type WizardStep = 'basics' | 'access' | 'privacy' | 'governance' | 'review';

const STEPS: WizardStep[] = ['basics', 'access', 'privacy', 'governance', 'review'];

const STEP_LABELS: Record<WizardStep, string> = {
  basics: 'Basics',
  access: 'Access',
  privacy: 'Privacy',
  governance: 'Governance',
  review: 'Review',
};

interface CreateOrganizationCloakProps {
  onSubmit: (config: OrganizationCloakConfig) => Promise<void>;
  isSubmitting?: boolean;
  userEmail?: string; // Auto-detected from auth
}

/**
 * Multi-step wizard for creating an Organization Cloak
 */
export function CreateOrganizationCloak({
  onSubmit,
  isSubmitting = false,
  userEmail,
}: CreateOrganizationCloakProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>('basics');
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [config, setConfig] = useState<OrganizationCloakConfig>({
    name: '',
    description: '',
    accessMethod: 'email-domain',
    emailDomain: userEmail ? userEmail.split('@')[1] : '',
    requireApproval: true,
    privacyPreset: 'balanced',
    votingDuration: 100800, // ~7 days at 6 second blocks
    quorumThreshold: 10,
    allowStandardProposals: true,
    allowAnonymousProposals: true,
    isPubliclySearchable: false,
    isPubliclyViewable: false,
  });

  const currentStepIndex = STEPS.indexOf(currentStep);

  const goToStep = (step: WizardStep) => {
    setError(null);
    setCurrentStep(step);
  };

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      goToStep(STEPS[currentStepIndex + 1]);
    }
  };

  const goBack = () => {
    if (currentStepIndex > 0) {
      goToStep(STEPS[currentStepIndex - 1]);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      await onSubmit(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Cloak');
    }
  };

  const updateConfig = (updates: Partial<OrganizationCloakConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {STEPS.map((step, index) => (
            <button
              key={step}
              onClick={() => index <= currentStepIndex && goToStep(step)}
              disabled={index > currentStepIndex}
              className={`text-sm font-medium transition-colors ${
                index === currentStepIndex
                  ? 'text-accent'
                  : index < currentStepIndex
                    ? 'text-foreground-secondary hover:text-foreground'
                    : 'text-foreground-muted'
              }`}
            >
              {STEP_LABELS[step]}
            </button>
          ))}
        </div>
        <div className="h-2 bg-background-tertiary rounded-full">
          <div
            className="h-2 bg-accent rounded-full transition-all"
            style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-status-error/10 border border-status-error/20 rounded-md text-status-error">
          {error}
        </div>
      )}

      {/* Step Content */}
      <div className="bg-card border border-border rounded-md p-6">
        {currentStep === 'basics' && (
          <BasicsStep config={config} onUpdate={updateConfig} />
        )}

        {currentStep === 'access' && (
          <AccessStep config={config} onUpdate={updateConfig} />
        )}

        {currentStep === 'privacy' && (
          <PrivacyStep config={config} onUpdate={updateConfig} />
        )}

        {currentStep === 'governance' && (
          <GovernanceStep config={config} onUpdate={updateConfig} />
        )}

        {currentStep === 'review' && <ReviewStep config={config} />}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={currentStepIndex === 0 ? () => router.back() : goBack}
          className="px-4 py-2 border border-border-hover hover:bg-card-hover text-foreground-secondary rounded-md transition-colors"
        >
          {currentStepIndex === 0 ? 'Cancel' : 'Back'}
        </button>

        {currentStep === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-accent hover:bg-accent-hover disabled:bg-accent/40 text-white rounded-md font-medium transition-colors"
          >
            {isSubmitting ? 'Creating...' : 'Create Cloak'}
          </button>
        ) : (
          <button
            onClick={goNext}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

// ===== STEP COMPONENTS =====

interface StepProps {
  config: OrganizationCloakConfig;
  onUpdate: (updates: Partial<OrganizationCloakConfig>) => void;
}

function BasicsStep({ config, onUpdate }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Organization Details</h2>
        <p className="text-foreground-muted">Basic information about your organization</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Organization Name *
        </label>
        <input
          type="text"
          value={config.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g., Acme Corp Governance"
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          maxLength={31}
        />
        <p className="text-xs text-foreground-muted mt-1">{config.name.length}/31 characters</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">Description</label>
        <textarea
          value={config.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Describe the purpose of this organization..."
          rows={3}
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>
    </div>
  );
}

function AccessStep({ config, onUpdate }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Member Access</h2>
        <p className="text-foreground-muted">How will members join your organization?</p>
      </div>

      <div className="space-y-4">
        <label className="flex items-start gap-3 p-4 border border-border rounded-md cursor-pointer hover:border-accent/50">
          <input
            type="radio"
            name="accessMethod"
            checked={config.accessMethod === 'email-domain'}
            onChange={() => onUpdate({ accessMethod: 'email-domain' })}
            className="mt-1"
          />
          <div>
            <p className="font-medium text-foreground">Email Domain Verification</p>
            <p className="text-sm text-foreground-muted">
              Members must verify they have an email address from a specific domain (e.g.,
              @company.com)
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-4 border border-border rounded-md cursor-pointer hover:border-accent/50">
          <input
            type="radio"
            name="accessMethod"
            checked={config.accessMethod === 'invite-only'}
            onChange={() => onUpdate({ accessMethod: 'invite-only' })}
            className="mt-1"
          />
          <div>
            <p className="font-medium text-foreground">Invite Only</p>
            <p className="text-sm text-foreground-muted">Only admins can add new members</p>
          </div>
        </label>
      </div>

      {config.accessMethod === 'email-domain' && (
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Allowed Email Domain *
          </label>
          <div className="flex items-center">
            <span className="px-3 py-2 bg-background-tertiary border border-r-0 border-border rounded-l-md text-foreground-muted">
              @
            </span>
            <input
              type="text"
              value={config.emailDomain}
              onChange={(e) => onUpdate({ emailDomain: e.target.value })}
              placeholder="company.com"
              className="flex-1 px-4 py-2 border border-border rounded-r-md focus:ring-2 focus:ring-ring focus:border-ring"
            />
          </div>
          <p className="text-xs text-foreground-muted mt-1">
            Only users with emails from this domain can join
          </p>
        </div>
      )}

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.requireApproval}
            onChange={(e) => onUpdate({ requireApproval: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-foreground-secondary">
            Require admin approval for new members
          </span>
        </label>
      </div>
    </div>
  );
}

function PrivacyStep({ config, onUpdate }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Privacy Settings</h2>
        <p className="text-foreground-muted">
          Choose how visible your organization's activities will be
        </p>
      </div>

      <div className="space-y-4">
        <label
          className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${
            config.privacyPreset === 'maximum'
              ? 'border-accent bg-accent-muted'
              : 'border-border hover:border-accent/50'
          }`}
        >
          <input
            type="radio"
            name="privacy"
            checked={config.privacyPreset === 'maximum'}
            onChange={() => onUpdate({ privacyPreset: 'maximum' })}
            className="mt-1"
          />
          <div>
            <p className="font-medium text-foreground">Maximum Privacy</p>
            <p className="text-sm text-foreground-muted">
              Everything hidden by default. Member list, proposals, and treasury all private.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-background-tertiary text-foreground-secondary text-xs rounded">
                Hidden members
              </span>
              <span className="px-2 py-0.5 bg-background-tertiary text-foreground-secondary text-xs rounded">
                Hidden proposals
              </span>
              <span className="px-2 py-0.5 bg-background-tertiary text-foreground-secondary text-xs rounded">
                Hidden treasury
              </span>
            </div>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${
            config.privacyPreset === 'balanced'
              ? 'border-accent bg-accent-muted'
              : 'border-border hover:border-accent/50'
          }`}
        >
          <input
            type="radio"
            name="privacy"
            checked={config.privacyPreset === 'balanced'}
            onChange={() => onUpdate({ privacyPreset: 'balanced' })}
            className="mt-1"
          />
          <div>
            <p className="font-medium text-foreground">Balanced (Recommended)</p>
            <p className="text-sm text-foreground-muted">
              Members can see each other. Proposals are public. Votes are always private.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-status-success/10 text-status-success text-xs rounded">
                Members visible
              </span>
              <span className="px-2 py-0.5 bg-status-success/10 text-status-success text-xs rounded">
                Public proposals
              </span>
              <span className="px-2 py-0.5 bg-accent-muted text-accent text-xs rounded">
                Private votes
              </span>
            </div>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer ${
            config.privacyPreset === 'transparent'
              ? 'border-accent bg-accent-muted'
              : 'border-border hover:border-accent/50'
          }`}
        >
          <input
            type="radio"
            name="privacy"
            checked={config.privacyPreset === 'transparent'}
            onChange={() => onUpdate({ privacyPreset: 'transparent' })}
            className="mt-1"
          />
          <div>
            <p className="font-medium text-foreground">Transparent</p>
            <p className="text-sm text-foreground-muted">
              Maximum visibility for public accountability. Votes remain private.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 bg-status-success/10 text-status-success text-xs rounded">
                Public members
              </span>
              <span className="px-2 py-0.5 bg-status-success/10 text-status-success text-xs rounded">
                Public treasury
              </span>
              <span className="px-2 py-0.5 bg-accent-muted text-accent text-xs rounded">
                Private votes (always)
              </span>
            </div>
          </div>
        </label>
      </div>

      <div className="p-4 bg-accent-muted border border-accent/20 rounded-md">
        <p className="text-sm text-accent">
          <strong>Important:</strong> Privacy can only become more public over time, never more
          private. This protects members who joined with certain privacy expectations.
        </p>
      </div>
    </div>
  );
}

function GovernanceStep({ config, onUpdate }: StepProps) {
  const votingDays = Math.round(config.votingDuration / (24 * 60 * 10)); // 6 second blocks

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Governance Settings</h2>
        <p className="text-foreground-muted">Configure how decisions are made</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Voting Duration: {votingDays} days
        </label>
        <input
          type="range"
          min={14400}
          max={302400}
          step={14400}
          value={config.votingDuration}
          onChange={(e) => onUpdate({ votingDuration: parseInt(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-foreground-muted">
          <span>1 day</span>
          <span>3 days</span>
          <span>7 days</span>
          <span>14 days</span>
          <span>21 days</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Quorum Threshold (minimum votes needed)
        </label>
        <input
          type="number"
          min={1}
          value={config.quorumThreshold}
          onChange={(e) => onUpdate({ quorumThreshold: parseInt(e.target.value) || 1 })}
          className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <p className="text-xs text-foreground-muted mt-1">
          Minimum total voting power needed for a proposal to pass
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground-secondary">Proposal Types</p>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.allowStandardProposals}
            onChange={(e) => onUpdate({ allowStandardProposals: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-foreground-secondary">Allow standard proposals (author visible)</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.allowAnonymousProposals}
            onChange={(e) => onUpdate({ allowAnonymousProposals: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm text-foreground-secondary">Allow anonymous proposals (author hidden)</span>
        </label>
      </div>
    </div>
  );
}

function ReviewStep({ config }: { config: OrganizationCloakConfig }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Review & Create</h2>
        <p className="text-foreground-muted">Confirm your organization settings</p>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-background-secondary rounded-md">
          <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
            Organization
          </h3>
          <p className="font-semibold text-foreground">{config.name || '(No name)'}</p>
          {config.description && <p className="text-foreground-secondary mt-1">{config.description}</p>}
        </div>

        <div className="p-4 bg-background-secondary rounded-md">
          <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
            Access
          </h3>
          <p className="text-foreground">
            {config.accessMethod === 'email-domain'
              ? `Domain: @${config.emailDomain}`
              : 'Invite only'}
          </p>
          <p className="text-foreground-secondary text-sm">
            {config.requireApproval ? 'Admin approval required' : 'Auto-approve members'}
          </p>
        </div>

        <div className="p-4 bg-background-secondary rounded-md">
          <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
            Privacy
          </h3>
          <p className="text-foreground capitalize">{config.privacyPreset}</p>
        </div>

        <div className="p-4 bg-background-secondary rounded-md">
          <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
            Governance
          </h3>
          <p className="text-foreground">
            Voting: {Math.round(config.votingDuration / (24 * 60 * 10))} days
          </p>
          <p className="text-foreground-secondary text-sm">Quorum: {config.quorumThreshold} votes</p>
          <p className="text-foreground-secondary text-sm">
            Proposals:{' '}
            {[
              config.allowStandardProposals && 'Standard',
              config.allowAnonymousProposals && 'Anonymous',
            ]
              .filter(Boolean)
              .join(', ') || 'None'}
          </p>
        </div>
      </div>

      <div className="p-4 bg-status-warning/10 border border-status-warning/20 rounded-md">
        <p className="text-sm text-status-warning">
          Creating this Cloak will deploy a smart contract to the Aztec network. This action cannot
          be undone.
        </p>
      </div>
    </div>
  );
}
