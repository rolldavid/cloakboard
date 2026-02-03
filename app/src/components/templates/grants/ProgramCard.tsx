'use client';

import React from 'react';

type ProgramStatus = 'active' | 'paused' | 'completed' | 'upcoming';

interface GrantProgram {
  id: string;
  name: string;
  description: string;
  totalBudget: bigint;
  remainingBudget: bigint;
  decimals: number;
  tokenSymbol: string;
  applicationsCount: number;
  approvedCount: number;
  status: ProgramStatus;
  deadline?: Date;
  categories: string[];
}

interface ProgramCardProps {
  program: GrantProgram;
  onApply?: () => void;
  onViewDetails?: () => void;
  compact?: boolean;
}

const STATUS_CONFIG: Record<ProgramStatus, { label: string; bgColor: string; textColor: string }> = {
  active: { label: 'Active', bgColor: 'bg-status-success/10', textColor: 'text-status-success' },
  paused: { label: 'Paused', bgColor: 'bg-status-warning/10', textColor: 'text-status-warning' },
  completed: { label: 'Completed', bgColor: 'bg-background-tertiary', textColor: 'text-foreground-secondary' },
  upcoming: { label: 'Upcoming', bgColor: 'bg-status-info/10', textColor: 'text-status-info' },
};

export function ProgramCard({
  program,
  onApply,
  onViewDetails,
  compact = false,
}: ProgramCardProps) {
  const statusConfig = STATUS_CONFIG[program.status];

  const formatAmount = (amount: bigint) => {
    const divisor = 10n ** BigInt(program.decimals);
    const integerPart = amount / divisor;
    return integerPart.toLocaleString();
  };

  const getBudgetPercentage = () => {
    if (program.totalBudget === 0n) return 0;
    const spent = program.totalBudget - program.remainingBudget;
    return Number((spent * 100n) / program.totalBudget);
  };

  const formatDeadline = () => {
    if (!program.deadline) return null;
    const now = new Date();
    const diff = program.deadline.getTime() - now.getTime();
    if (diff <= 0) return 'Deadline passed';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return program.deadline.toLocaleDateString();
    if (days > 0) return `${days} days left`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    return `${hours} hours left`;
  };

  const budgetPercentage = getBudgetPercentage();
  const deadline = formatDeadline();

  if (compact) {
    return (
      <div className="bg-card border border-border rounded-md p-4 hover:border-border-hover transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-foreground">{program.name}</h4>
            <p className="text-sm text-foreground-muted">
              {formatAmount(program.remainingBudget)} {program.tokenSymbol} remaining
            </p>
          </div>
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.textColor}`}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden hover:border-border-hover transition-colors">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">{program.name}</h3>
              <span
                className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.textColor}`}
              >
                {statusConfig.label}
              </span>
            </div>
            {deadline && (
              <p className="text-sm text-foreground-muted mt-1">
                <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {deadline}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-foreground-secondary text-sm mb-4 line-clamp-2">{program.description}</p>

        {/* Categories */}
        {program.categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {program.categories.map((cat) => (
              <span
                key={cat}
                className="px-2 py-0.5 text-xs font-medium bg-accent-muted text-accent rounded"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        {/* Budget */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-foreground-secondary">Budget</span>
            <span className="font-medium text-foreground">
              {formatAmount(program.remainingBudget)} / {formatAmount(program.totalBudget)} {program.tokenSymbol}
            </span>
          </div>
          <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${budgetPercentage}%` }}
            />
          </div>
          <p className="text-xs text-foreground-muted mt-1">{budgetPercentage}% allocated</p>
        </div>

        {/* Stats */}
        <div className="flex gap-6 text-sm text-foreground-muted mb-4">
          <span>{program.applicationsCount} applications</span>
          <span>{program.approvedCount} approved</span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {program.status === 'active' && onApply && (
            <button
              onClick={onApply}
              className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors"
            >
              Apply Now
            </button>
          )}
          {onViewDetails && (
            <button
              onClick={onViewDetails}
              className="flex-1 px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary text-sm rounded-md transition-colors"
            >
              View Details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
