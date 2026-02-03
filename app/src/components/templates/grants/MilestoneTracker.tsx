'use client';

import React from 'react';

type MilestoneStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected';

interface Milestone {
  id: string;
  title: string;
  description: string;
  percentage: number;
  amount: bigint;
  status: MilestoneStatus;
  submittedAt?: Date;
  approvedAt?: Date;
  feedback?: string;
}

interface MilestoneTrackerProps {
  milestones: Milestone[];
  totalAmount: bigint;
  decimals: number;
  tokenSymbol: string;
  grantTitle: string;
  isRecipient?: boolean;
  onSubmitMilestone?: (milestoneId: string) => void;
  onApproveMilestone?: (milestoneId: string) => void;
  onRejectMilestone?: (milestoneId: string, feedback: string) => void;
}

const STATUS_CONFIG: Record<MilestoneStatus, { label: string; bgColor: string; textColor: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    bgColor: 'bg-background-tertiary',
    textColor: 'text-foreground-secondary',
    icon: <div className="w-3 h-3 rounded-full border-2 border-border" />,
  },
  in_progress: {
    label: 'In Progress',
    bgColor: 'bg-status-info/10',
    textColor: 'text-status-info',
    icon: <div className="w-3 h-3 rounded-full bg-status-info" />,
  },
  submitted: {
    label: 'Awaiting Review',
    bgColor: 'bg-status-warning/10',
    textColor: 'text-status-warning',
    icon: <div className="w-3 h-3 rounded-full bg-status-warning" />,
  },
  approved: {
    label: 'Approved',
    bgColor: 'bg-status-success/10',
    textColor: 'text-status-success',
    icon: (
      <svg className="w-4 h-4 text-status-success" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  rejected: {
    label: 'Needs Revision',
    bgColor: 'bg-status-error/10',
    textColor: 'text-status-error',
    icon: (
      <svg className="w-4 h-4 text-status-error" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
  },
};

export function MilestoneTracker({
  milestones,
  totalAmount,
  decimals,
  tokenSymbol,
  grantTitle,
  isRecipient = false,
  onSubmitMilestone,
  onApproveMilestone,
  onRejectMilestone,
}: MilestoneTrackerProps) {
  const formatAmount = (amount: bigint) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    return integerPart.toLocaleString();
  };

  const getProgress = () => {
    const approved = milestones.filter((m) => m.status === 'approved');
    const approvedPercentage = approved.reduce((sum, m) => sum + m.percentage, 0);
    const approvedAmount = approved.reduce((sum, m) => sum + m.amount, 0n);
    return { percentage: approvedPercentage, amount: approvedAmount };
  };

  const progress = getProgress();

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">{grantTitle}</h3>
        <p className="text-sm text-foreground-muted mt-1">
          {progress.percentage}% complete ({formatAmount(progress.amount)} / {formatAmount(totalAmount)} {tokenSymbol})
        </p>

        {/* Progress Bar */}
        <div className="mt-3 h-2 bg-background-tertiary rounded-full overflow-hidden">
          <div
            className="h-full bg-status-success rounded-full transition-all"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      {/* Milestones */}
      <div className="divide-y divide-border">
        {milestones.map((milestone, index) => {
          const statusConfig = STATUS_CONFIG[milestone.status];
          const canSubmit = isRecipient && (milestone.status === 'pending' || milestone.status === 'in_progress' || milestone.status === 'rejected');
          const canReview = !isRecipient && milestone.status === 'submitted';

          return (
            <div key={milestone.id} className="px-6 py-4">
              <div className="flex items-start gap-4">
                {/* Timeline indicator */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background-tertiary">
                    {statusConfig.icon}
                  </div>
                  {index < milestones.length - 1 && (
                    <div className={`w-0.5 h-full min-h-[40px] ${
                      milestone.status === 'approved' ? 'bg-status-success' : 'bg-border'
                    }`} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-foreground">{milestone.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.textColor}`}
                        >
                          {statusConfig.label}
                        </span>
                        <span className="text-sm text-foreground-muted">
                          {milestone.percentage}% ({formatAmount(milestone.amount)} {tokenSymbol})
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-foreground-secondary mt-2">{milestone.description}</p>

                  {/* Feedback (if rejected) */}
                  {milestone.feedback && milestone.status === 'rejected' && (
                    <div className="mt-3 p-3 bg-status-error/10 border border-status-error rounded-md">
                      <p className="text-sm text-status-error">
                        <span className="font-medium">Feedback:</span> {milestone.feedback}
                      </p>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="flex gap-4 mt-2 text-xs text-foreground-muted">
                    {milestone.submittedAt && (
                      <span>Submitted: {milestone.submittedAt.toLocaleDateString()}</span>
                    )}
                    {milestone.approvedAt && (
                      <span>Approved: {milestone.approvedAt.toLocaleDateString()}</span>
                    )}
                  </div>

                  {/* Actions */}
                  {(canSubmit || canReview) && (
                    <div className="mt-3 flex gap-2">
                      {canSubmit && onSubmitMilestone && (
                        <button
                          onClick={() => onSubmitMilestone(milestone.id)}
                          className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
                        >
                          Submit for Review
                        </button>
                      )}
                      {canReview && onApproveMilestone && (
                        <button
                          onClick={() => onApproveMilestone(milestone.id)}
                          className="px-3 py-1.5 text-sm bg-status-success hover:bg-status-success text-white rounded-md transition-colors"
                        >
                          Approve
                        </button>
                      )}
                      {canReview && onRejectMilestone && (
                        <button
                          onClick={() => {
                            const feedback = prompt('Enter feedback for revision:');
                            if (feedback) onRejectMilestone(milestone.id, feedback);
                          }}
                          className="px-3 py-1.5 text-sm border border-border-hover text-status-error hover:bg-status-error/10 rounded-md transition-colors"
                        >
                          Request Revision
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
