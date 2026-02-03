'use client';

import React, { useState, useMemo } from 'react';
import type { TemplateId } from '@/lib/templates/TemplateFactory';

interface ProposalFormProps {
  onSubmit: (proposal: {
    title: string;
    description: string;
    proposalType: number;
    targetAddress: string;
    value: bigint;
    isAnonymous?: boolean;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
  templateId?: number;
  allowAnonymous?: boolean;
  privacyLevel?: 'maximum' | 'balanced' | 'transparent';
}

// Base proposal types available to all Cloaks
const BASE_PROPOSAL_TYPES = [
  { value: 0, label: 'Treasury', description: 'Transfer funds from treasury' },
  { value: 1, label: 'Member', description: 'Add or modify membership' },
  { value: 2, label: 'Settings', description: 'Change Cloak settings' },
];

// Template-specific proposal types
const TEMPLATE_PROPOSAL_TYPES: Partial<Record<number, Array<{ value: number; label: string; description: string }>>> = {
  2: [ // Treasury
    { value: 3, label: 'Budget Allocation', description: 'Allocate budget to a category' },
    { value: 4, label: 'Spending Approval', description: 'Approve specific spending request' },
  ],
  4: [ // Investment Club
    { value: 3, label: 'Investment', description: 'Propose new investment opportunity' },
    { value: 4, label: 'Distribution', description: 'Distribute returns to members' },
  ],
  5: [ // Grants
    { value: 3, label: 'Grant Application', description: 'Submit or review grant application' },
    { value: 4, label: 'Milestone Approval', description: 'Approve project milestone' },
  ],
  6: [ // Governor Bravo
    { value: 3, label: 'Protocol Change', description: 'Propose protocol parameter change' },
    { value: 4, label: 'Emergency Action', description: 'Propose emergency action' },
  ],
  7: [ // Collector
    { value: 3, label: 'Acquisition', description: 'Propose new acquisition' },
    { value: 4, label: 'Sale', description: 'Propose selling an asset' },
  ],
  8: [ // Service Guild
    { value: 3, label: 'Job Posting', description: 'Post new job opportunity' },
    { value: 4, label: 'Dispute Resolution', description: 'Resolve member dispute' },
  ],
  10: [ // Research
    { value: 3, label: 'Research Proposal', description: 'Submit research proposal' },
    { value: 4, label: 'Peer Review', description: 'Request peer review' },
  ],
};

export function ProposalForm({
  onSubmit,
  isLoading = false,
  onCancel,
  templateId,
  allowAnonymous = false,
  privacyLevel = 'balanced',
}: ProposalFormProps) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    proposalType: 0,
    targetAddress: '',
    value: '0',
    isAnonymous: false,
  });

  // Get available proposal types based on template
  const proposalTypes = useMemo(() => {
    const types = [...BASE_PROPOSAL_TYPES];
    if (templateId && TEMPLATE_PROPOSAL_TYPES[templateId]) {
      types.push(...TEMPLATE_PROPOSAL_TYPES[templateId]!);
    }
    return types;
  }, [templateId]);

  // Determine if anonymous proposals are supported
  const canBeAnonymous = useMemo(() => {
    // Anonymous proposals are supported for workplace (3) and maximum privacy Cloaks
    return allowAnonymous || templateId === 3 || privacyLevel === 'maximum';
  }, [allowAnonymous, templateId, privacyLevel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      title: form.title,
      description: form.description,
      proposalType: form.proposalType,
      targetAddress: form.targetAddress,
      value: BigInt(form.value || '0'),
      isAnonymous: form.isAnonymous,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Title
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          maxLength={31}
          required
          placeholder="Proposal title"
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <p className="mt-1 text-xs text-foreground-muted">Max 31 characters</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Description
        </label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          maxLength={31}
          required
          placeholder="Brief description"
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <p className="mt-1 text-xs text-foreground-muted">Max 31 characters</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Proposal Type
        </label>
        <select
          value={form.proposalType}
          onChange={(e) => setForm({ ...form, proposalType: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        >
          {proposalTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label} - {type.description}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Target Address
        </label>
        <input
          type="text"
          value={form.targetAddress}
          onChange={(e) => setForm({ ...form, targetAddress: e.target.value })}
          required
          placeholder="0x..."
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Value
        </label>
        <input
          type="number"
          value={form.value}
          onChange={(e) => setForm({ ...form, value: e.target.value })}
          min="0"
          placeholder="0"
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <p className="mt-1 text-xs text-foreground-muted">
          Amount or parameter value for the proposal
        </p>
      </div>

      {/* Anonymous Proposal Option */}
      {canBeAnonymous && (
        <div className="flex items-start gap-3 p-4 bg-background-secondary rounded-md">
          <input
            type="checkbox"
            id="isAnonymous"
            checked={form.isAnonymous}
            onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })}
            className="mt-1 h-4 w-4 text-accent focus:ring-ring border-border rounded"
          />
          <div>
            <label htmlFor="isAnonymous" className="block text-sm font-medium text-foreground-secondary">
              Submit Anonymously
            </label>
            <p className="text-xs text-foreground-muted mt-0.5">
              Your identity will be hidden from other members. Only you will know you submitted this proposal.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-foreground-secondary hover:text-foreground"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading || !form.title || !form.targetAddress}
          className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Creating...' : 'Create Proposal'}
        </button>
      </div>
    </form>
  );
}
