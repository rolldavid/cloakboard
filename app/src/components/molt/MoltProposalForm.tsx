'use client';

import React, { useState } from 'react';

const MOLT_PROPOSAL_TYPES = [
  { value: 0, label: 'General', description: 'General governance proposal for community discussion and signaling' },
  { value: 1, label: 'Toggle Discussion Visibility', description: 'Toggle between always-public (24h) and always-private (0h)' },
  { value: 2, label: 'Update Rate Limits', description: 'Change post cooldown, comment cooldown, or daily comment limits' },
  { value: 3, label: 'Update Viewing Hours', description: 'Change how many hours per day the Molt is publicly viewable' },
];

interface MoltProposalFormProps {
  onSubmit: (proposal: { content: string; proposalType: number; proposedHours?: number }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  minPublicHours?: number;
}

export function MoltProposalForm({ onSubmit, onCancel, isLoading = false, minPublicHours = 0 }: MoltProposalFormProps) {
  const [content, setContent] = useState('');
  const [proposalType, setProposalType] = useState(0);
  const [proposedHours, setProposedHours] = useState(12);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    await onSubmit({
      content: content.trim(),
      proposalType,
      ...(proposalType === 3 ? { proposedHours } : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-md p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
          Proposal Type
        </label>
        <div className="space-y-2">
          {MOLT_PROPOSAL_TYPES.map((type) => (
            <label
              key={type.value}
              className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                proposalType === type.value
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-border-hover'
              }`}
            >
              <input
                type="radio"
                name="proposalType"
                value={type.value}
                checked={proposalType === type.value}
                onChange={() => setProposalType(type.value)}
                className="mt-0.5 h-4 w-4 text-accent focus:ring-accent border-border"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{type.label}</p>
                <p className="text-xs text-foreground-muted mt-0.5">{type.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
          Description
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            proposalType === 1
              ? 'Explain why discussion visibility should be toggled...'
              : proposalType === 2
              ? 'Describe the rate limit changes you propose...'
              : 'Describe your proposal...'
          }
          rows={4}
          required
          className="w-full bg-background-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted resize-y focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {proposalType === 1 && (
        <div className="p-3 bg-status-warning/5 border border-status-warning/20 rounded-md">
          <p className="text-xs text-status-warning">
            If passed and executed, this will toggle the discussion visibility setting.
            Public discussions become private, and vice versa.
          </p>
        </div>
      )}

      {proposalType === 2 && (
        <div className="p-3 bg-status-info/5 border border-status-info/20 rounded-md">
          <p className="text-xs text-status-info">
            Rate limit proposals signal intent to change post cooldown, comment cooldown, or daily limits.
            The admin applies the new values after execution.
          </p>
        </div>
      )}

      {proposalType === 3 && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Proposed public hours per day
            </label>
            <input
              type="number"
              min={minPublicHours}
              max={24}
              value={proposedHours}
              onChange={(e) => setProposedHours(Math.min(24, Math.max(minPublicHours, Number(e.target.value))))}
              className="w-20 px-3 py-1.5 border border-border rounded-md text-sm focus:ring-1 focus:ring-accent"
            />
            <p className="text-xs text-foreground-muted mt-1">
              {minPublicHours > 0 ? `Minimum: ${minPublicHours} hours (governance floor)` : 'Range: 0–24 hours'}
            </p>
          </div>
          <div className="p-3 bg-accent/5 border border-accent/20 rounded-md">
            <p className="text-xs text-accent">
              If passed, this will set the Molt to {proposedHours} public hours per day starting at 10:00 UTC.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading || !content.trim()}
          className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Creating...' : 'Create Proposal'}
        </button>
      </div>
    </form>
  );
}
