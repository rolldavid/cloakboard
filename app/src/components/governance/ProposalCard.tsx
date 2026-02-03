'use client';

import React from 'react';
import { VoteButton } from './VoteButton';
import { TallyDisplay } from './TallyDisplay';

interface ProposalCardProps {
  id: number;
  title: string;
  description: string;
  proposalType: number;
  creator: string;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  yesVotes: bigint;
  noVotes: bigint;
  abstainVotes: bigint;
  totalVotes: bigint;
  currentBlock?: number;
  onVote?: (proposalId: bigint, support: number) => Promise<void>;
  onExecute?: (proposalId: bigint) => Promise<void>;
  isLoading?: boolean;
}

const PROPOSAL_TYPES = ['Treasury', 'Member', 'Settings'];

export function ProposalCard({
  id,
  title,
  description,
  proposalType,
  creator,
  startBlock,
  endBlock,
  executed,
  yesVotes,
  noVotes,
  abstainVotes,
  totalVotes,
  currentBlock = 0,
  onVote,
  onExecute,
  isLoading = false,
}: ProposalCardProps) {
  const isActive = currentBlock <= endBlock && !executed;
  const isPassed = yesVotes > noVotes;
  const canExecute = !executed && !isActive && isPassed;

  const getStatusBadge = () => {
    if (executed) {
      return <span className="px-2 py-1 bg-status-success/10 text-status-success text-xs rounded-full">Executed</span>;
    }
    if (isActive) {
      return <span className="px-2 py-1 bg-status-info/10 text-status-info text-xs rounded-full">Active</span>;
    }
    if (isPassed) {
      return <span className="px-2 py-1 bg-status-warning/10 text-status-warning text-xs rounded-full">Passed</span>;
    }
    return <span className="px-2 py-1 bg-status-error/10 text-status-error text-xs rounded-full">Failed</span>;
  };

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-foreground-muted uppercase tracking-wide">
              {PROPOSAL_TYPES[proposalType] || 'Unknown'} #{id}
            </span>
            {getStatusBadge()}
          </div>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
      </div>

      <p className="text-foreground-secondary mb-4">{description}</p>

      <div className="text-xs text-foreground-muted mb-4">
        <span>Proposed by: {creator.slice(0, 10)}...</span>
        <span className="mx-2">|</span>
        <span>Blocks: {startBlock} - {endBlock}</span>
      </div>

      <TallyDisplay
        yesVotes={yesVotes}
        noVotes={noVotes}
        abstainVotes={abstainVotes}
        totalVotes={totalVotes}
      />

      {isActive && onVote && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-sm text-foreground-muted mb-3">Cast your vote:</p>
          <div className="flex gap-3">
            <VoteButton
              label="Vote For"
              variant="yes"
              onClick={() => onVote(BigInt(id), 1)}
              disabled={isLoading}
            />
            <VoteButton
              label="Vote Against"
              variant="no"
              onClick={() => onVote(BigInt(id), 0)}
              disabled={isLoading}
            />
            <VoteButton
              label="Abstain"
              variant="abstain"
              onClick={() => onVote(BigInt(id), 2)}
              disabled={isLoading}
            />
          </div>
        </div>
      )}

      {canExecute && onExecute && (
        <div className="mt-4 pt-4 border-t border-border">
          <button
            onClick={() => onExecute(BigInt(id))}
            disabled={isLoading}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Executing...' : 'Execute Proposal'}
          </button>
        </div>
      )}
    </div>
  );
}
