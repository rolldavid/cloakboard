'use client';

import React from 'react';

const PROPOSAL_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  general: { label: 'General', color: 'text-foreground-muted bg-background-tertiary' },
  toggle_discussion: { label: 'Toggle Discussion Visibility', color: 'text-status-warning bg-status-warning/10' },
  update_rate_limits: { label: 'Update Rate Limits', color: 'text-status-info bg-status-info/10' },
  update_viewing_hours: { label: 'Update Viewing Hours', color: 'text-accent bg-accent/10' },
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-status-info/10 text-status-info' },
  passed: { label: 'Passed', className: 'bg-status-success/10 text-status-success' },
  rejected: { label: 'Rejected', className: 'bg-status-error/10 text-status-error' },
  executed: { label: 'Executed', className: 'bg-accent/10 text-accent' },
};

interface MoltProposalCardProps {
  proposal: {
    id: number;
    content: string | null;
    author: string;
    votesFor: number;
    votesAgainst: number;
    status: string;
    endBlock: number;
    snapshotBlock?: number;
    type: string;
    proposedHours?: number;
  };
  isMember: boolean;
  onVote?: (proposalId: number, support: boolean) => void;
  onExecute?: (proposalId: number) => void;
  isLoading?: boolean;
}

export function MoltProposalCard({
  proposal,
  isMember,
  onVote,
  onExecute,
  isLoading = false,
}: MoltProposalCardProps) {
  const typeInfo = PROPOSAL_TYPE_LABELS[proposal.type] || PROPOSAL_TYPE_LABELS.general;
  const statusInfo = STATUS_BADGES[proposal.status] || STATUS_BADGES.active;
  const totalVotes = proposal.votesFor + proposal.votesAgainst;
  const forPct = totalVotes > 0 ? Math.round((proposal.votesFor / totalVotes) * 100) : 0;
  const againstPct = totalVotes > 0 ? 100 - forPct : 0;
  const isActive = proposal.status === 'active';
  const isPassed = proposal.status === 'passed';
  const canExecute = isPassed && onExecute;

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs ${statusInfo.className}`}>
              {statusInfo.label}
            </span>
          </div>
          <span className="text-xs text-foreground-muted">#{proposal.id}</span>
        </div>

        {/* Content */}
        <div className="text-sm text-foreground whitespace-pre-wrap break-words mb-3">
          {proposal.content || <span className="italic text-foreground-muted">Content unavailable</span>}
        </div>

        {/* Proposed hours for viewing hours proposals */}
        {proposal.type === 'update_viewing_hours' && proposal.proposedHours !== undefined && (
          <div className="mb-3 p-2 bg-accent/5 border border-accent/20 rounded text-xs text-accent">
            Proposed: {proposal.proposedHours} public hours/day
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-foreground-muted mb-4">
          <span className="font-mono bg-background-tertiary px-1.5 py-0.5 rounded">
            {proposal.author?.slice(0, 10)}...
          </span>
          <span>Ends at block {proposal.endBlock}</span>
          {proposal.snapshotBlock && (
            <span>Snapshot: block {proposal.snapshotBlock}</span>
          )}
        </div>

        {/* Vote tally bar */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-foreground-muted mb-1">
            <span>For: {proposal.votesFor} ({forPct}%)</span>
            <span>Against: {proposal.votesAgainst} ({againstPct}%)</span>
          </div>
          <div className="h-2 bg-background-tertiary rounded-full overflow-hidden flex">
            {totalVotes > 0 && (
              <>
                <div
                  className="bg-status-success h-full transition-all"
                  style={{ width: `${forPct}%` }}
                />
                <div
                  className="bg-status-error h-full transition-all"
                  style={{ width: `${againstPct}%` }}
                />
              </>
            )}
          </div>
          <p className="text-xs text-foreground-muted mt-1 text-center">
            {totalVotes} total {totalVotes === 1 ? 'vote' : 'votes'}
          </p>
        </div>

        {/* Actions */}
        {isActive && isMember && onVote && (
          <div className="flex gap-2 pt-3 border-t border-border">
            <button
              onClick={() => onVote(proposal.id, true)}
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-status-success/10 hover:bg-status-success/20 text-status-success text-sm rounded-md transition-colors disabled:opacity-50"
            >
              Vote For
            </button>
            <button
              onClick={() => onVote(proposal.id, false)}
              disabled={isLoading}
              className="flex-1 px-3 py-2 bg-status-error/10 hover:bg-status-error/20 text-status-error text-sm rounded-md transition-colors disabled:opacity-50"
            >
              Vote Against
            </button>
          </div>
        )}

        {canExecute && (
          <div className="pt-3 border-t border-border">
            <button
              onClick={() => onExecute(proposal.id)}
              disabled={isLoading}
              className="w-full px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Executing...' : 'Execute Proposal'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
