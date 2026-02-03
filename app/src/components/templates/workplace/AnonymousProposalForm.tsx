'use client';

import React, { useState } from 'react';

interface AnonymousProposalFormProps {
  proposalTypes: Array<{ value: number; label: string; description: string }>;
  onSubmit: (proposal: {
    title: string;
    description: string;
    proposalType: number;
  }) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
}

export function AnonymousProposalForm({
  proposalTypes,
  onSubmit,
  isLoading = false,
  onCancel,
}: AnonymousProposalFormProps) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    proposalType: proposalTypes[0]?.value || 0,
    confirmAnonymous: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.confirmAnonymous) return;

    await onSubmit({
      title: form.title,
      description: form.description,
      proposalType: form.proposalType,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Anonymous Notice */}
      <div className="bg-accent-muted border border-accent rounded-md p-4">
        <div className="flex items-start gap-3">
          <svg
            className="w-6 h-6 text-accent flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <h4 className="font-medium text-foreground">Anonymous Submission</h4>
            <p className="text-sm text-foreground-secondary mt-1">
              This proposal will be submitted anonymously. Your identity will be protected using
              zero-knowledge proofs. No one, including admins, will be able to trace this
              proposal back to you.
            </p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Proposal Type
        </label>
        <select
          value={form.proposalType}
          onChange={(e) => setForm({ ...form, proposalType: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
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
          Title
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          placeholder="Enter a clear, descriptive title"
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
          rows={5}
          placeholder="Provide details about your proposal. Remember: avoid including information that could identify you."
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
        <p className="mt-1 text-xs text-foreground-muted">
          Tip: Avoid mentioning specific projects, dates, or details that could identify you.
        </p>
      </div>

      {/* Confirmation Checkbox */}
      <div className="flex items-start gap-3 p-4 bg-background-secondary rounded-md">
        <input
          type="checkbox"
          id="confirmAnonymous"
          checked={form.confirmAnonymous}
          onChange={(e) => setForm({ ...form, confirmAnonymous: e.target.checked })}
          className="mt-1 h-4 w-4 text-accent focus:ring-ring border-border-hover rounded"
        />
        <label htmlFor="confirmAnonymous" className="text-sm text-foreground-secondary">
          I understand that this proposal will be submitted anonymously and I have not included
          any personally identifiable information in my submission.
        </label>
      </div>

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
          disabled={isLoading || !form.title || !form.description || !form.confirmAnonymous}
          className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Submitting...' : 'Submit Anonymously'}
        </button>
      </div>
    </form>
  );
}
