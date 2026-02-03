'use client';

import React, { useState } from 'react';

interface ApplicationFormProps {
  programName: string;
  categories: string[];
  maxAmount: bigint;
  decimals: number;
  tokenSymbol: string;
  onSubmit: (application: {
    title: string;
    description: string;
    category: string;
    requestedAmount: bigint;
    milestones: Array<{ title: string; description: string; percentage: number }>;
    teamInfo?: string;
    links?: string[];
  }) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
}

export function ApplicationForm({
  programName,
  categories,
  maxAmount,
  decimals,
  tokenSymbol,
  onSubmit,
  isLoading = false,
  onCancel,
}: ApplicationFormProps) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: categories[0] || '',
    requestedAmount: '',
    teamInfo: '',
    links: [''],
    milestones: [
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
      { title: '', description: '', percentage: 25 },
    ],
  });

  const formatMaxAmount = () => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = maxAmount / divisor;
    return integerPart.toLocaleString();
  };

  const getTotalMilestonePercentage = () => {
    return form.milestones.reduce((sum, m) => sum + m.percentage, 0);
  };

  const handleMilestoneChange = (index: number, field: keyof typeof form.milestones[0], value: string | number) => {
    const newMilestones = [...form.milestones];
    newMilestones[index] = { ...newMilestones[index], [field]: value };
    setForm({ ...form, milestones: newMilestones });
  };

  const addMilestone = () => {
    if (form.milestones.length >= 10) return;
    setForm({
      ...form,
      milestones: [...form.milestones, { title: '', description: '', percentage: 0 }],
    });
  };

  const removeMilestone = (index: number) => {
    if (form.milestones.length <= 1) return;
    const newMilestones = form.milestones.filter((_, i) => i !== index);
    setForm({ ...form, milestones: newMilestones });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requestedAmount = BigInt(Math.floor(parseFloat(form.requestedAmount) * 10 ** decimals));

    await onSubmit({
      title: form.title,
      description: form.description,
      category: form.category,
      requestedAmount,
      milestones: form.milestones.filter((m) => m.title),
      teamInfo: form.teamInfo || undefined,
      links: form.links.filter((l) => l) || undefined,
    });
  };

  const isOverMax = () => {
    if (!form.requestedAmount) return false;
    try {
      const amount = BigInt(Math.floor(parseFloat(form.requestedAmount) * 10 ** decimals));
      return amount > maxAmount;
    } catch {
      return false;
    }
  };

  const totalPercentage = getTotalMilestonePercentage();

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-accent-muted border border-accent rounded-md p-4">
        <h3 className="font-medium text-foreground">Apply to: {programName}</h3>
        <p className="text-sm text-accent mt-1">
          Maximum grant amount: {formatMaxAmount()} {tokenSymbol}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Project Title
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          placeholder="Enter your project title"
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Category
          </label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Requested Amount
          </label>
          <div className="relative">
            <input
              type="number"
              value={form.requestedAmount}
              onChange={(e) => setForm({ ...form, requestedAmount: e.target.value })}
              required
              min="0"
              step="any"
              placeholder="0.00"
              className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-ring focus:border-ring ${
                isOverMax() ? 'border-border-hover bg-status-error/10' : 'border-border'
              }`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted">
              {tokenSymbol}
            </span>
          </div>
          {isOverMax() && (
            <p className="mt-1 text-sm text-status-error">Exceeds maximum amount</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Project Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
          rows={5}
          placeholder="Describe your project, its goals, and expected impact..."
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground-secondary">
            Milestones
          </label>
          <span className={`text-sm ${totalPercentage === 100 ? 'text-status-success' : 'text-status-error'}`}>
            Total: {totalPercentage}% (must equal 100%)
          </span>
        </div>

        <div className="space-y-3">
          {form.milestones.map((milestone, index) => (
            <div key={index} className="p-4 bg-background-secondary rounded-md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground-secondary">Milestone {index + 1}</span>
                {form.milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(index)}
                    className="text-status-error hover:text-status-error text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  value={milestone.title}
                  onChange={(e) => handleMilestoneChange(index, 'title', e.target.value)}
                  placeholder="Title"
                  className="col-span-2 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                />
                <div className="relative">
                  <input
                    type="number"
                    value={milestone.percentage}
                    onChange={(e) => handleMilestoneChange(index, 'percentage', parseInt(e.target.value) || 0)}
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted">%</span>
                </div>
              </div>
              <textarea
                value={milestone.description}
                onChange={(e) => handleMilestoneChange(index, 'description', e.target.value)}
                placeholder="Describe the deliverables for this milestone..."
                rows={2}
                className="w-full mt-2 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>
          ))}
        </div>

        {form.milestones.length < 10 && (
          <button
            type="button"
            onClick={addMilestone}
            className="mt-2 text-sm text-accent hover:text-accent"
          >
            + Add Milestone
          </button>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Team Information (optional)
        </label>
        <textarea
          value={form.teamInfo}
          onChange={(e) => setForm({ ...form, teamInfo: e.target.value })}
          rows={3}
          placeholder="Tell us about your team and relevant experience..."
          className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
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
          disabled={isLoading || !form.title || !form.requestedAmount || isOverMax() || totalPercentage !== 100}
          className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Submitting...' : 'Submit Application'}
        </button>
      </div>
    </form>
  );
}
