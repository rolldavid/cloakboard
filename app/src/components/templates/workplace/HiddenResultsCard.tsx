'use client';

import React from 'react';

type VoteStatus = 'not_voted' | 'voted' | 'revealed';

interface HiddenResultsCardProps {
  proposalId: string;
  proposalTitle: string;
  status: VoteStatus;
  endsAt: Date;
  totalVotes?: number;
  quorumRequired?: number;
  yourVote?: boolean; // true = for, false = against, undefined = not voted
  revealedResults?: {
    votesFor: number;
    votesAgainst: number;
    passed: boolean;
  };
  onVote?: (support: boolean) => Promise<void>;
  isVoting?: boolean;
}

export function HiddenResultsCard({
  proposalId,
  proposalTitle,
  status,
  endsAt,
  totalVotes,
  quorumRequired,
  yourVote,
  revealedResults,
  onVote,
  isVoting = false,
}: HiddenResultsCardProps) {
  const isEnded = endsAt.getTime() < Date.now();
  const hasVoted = yourVote !== undefined;

  const formatTimeRemaining = () => {
    const now = new Date();
    const diff = endsAt.getTime() - now.getTime();
    if (diff <= 0) return 'Voting ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h remaining`;
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${minutes}m remaining`;
  };

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{proposalTitle}</h3>
            <p className="text-sm text-foreground-muted mt-1">{formatTimeRemaining()}</p>
          </div>

          {status === 'voted' && (
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-status-success/10 text-status-success">
              Voted
            </span>
          )}
          {status === 'revealed' && revealedResults && (
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                revealedResults.passed
                  ? 'bg-status-success/10 text-status-success'
                  : 'bg-status-error/10 text-status-error'
              }`}
            >
              {revealedResults.passed ? 'Passed' : 'Rejected'}
            </span>
          )}
        </div>

        {/* Hidden Results Notice */}
        {status !== 'revealed' && (
          <div className="mb-4 p-4 bg-background-secondary rounded-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-background-tertiary flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-foreground-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              </div>
              <div>
                <p className="font-medium text-foreground">Results are hidden</p>
                <p className="text-sm text-foreground-muted">
                  Vote tallies will be revealed when voting ends to prevent bias.
                </p>
              </div>
            </div>

            {totalVotes !== undefined && (
              <div className="mt-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground-secondary">Participation</span>
                    <span className="text-foreground font-medium">{totalVotes} votes</span>
                  </div>
                  {quorumRequired && (
                    <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${Math.min((totalVotes / quorumRequired) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                  {quorumRequired && (
                    <p className="text-xs text-foreground-muted mt-1">
                      {totalVotes >= quorumRequired
                        ? 'Quorum reached'
                        : `${quorumRequired - totalVotes} more votes needed for quorum`}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Revealed Results */}
        {status === 'revealed' && revealedResults && (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-status-success font-medium">
                For: {revealedResults.votesFor} ({Math.round((revealedResults.votesFor / (revealedResults.votesFor + revealedResults.votesAgainst)) * 100)}%)
              </span>
              <span className="text-status-error font-medium">
                Against: {revealedResults.votesAgainst} ({Math.round((revealedResults.votesAgainst / (revealedResults.votesFor + revealedResults.votesAgainst)) * 100)}%)
              </span>
            </div>
            <div className="h-3 bg-background-tertiary rounded-full overflow-hidden flex">
              <div
                className="h-full bg-status-success"
                style={{
                  width: `${(revealedResults.votesFor / (revealedResults.votesFor + revealedResults.votesAgainst)) * 100}%`,
                }}
              />
              <div
                className="h-full bg-status-error"
                style={{
                  width: `${(revealedResults.votesAgainst / (revealedResults.votesFor + revealedResults.votesAgainst)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Your Vote Status */}
        {hasVoted && (
          <div className="mb-4 p-3 bg-accent-muted border border-accent rounded-md">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span className="text-sm font-medium text-foreground">
                You voted {yourVote ? 'For' : 'Against'}
              </span>
              <span className="text-xs text-accent">(private)</span>
            </div>
          </div>
        )}

        {/* Vote Actions */}
        {!isEnded && !hasVoted && onVote && (
          <div className="flex gap-3">
            <button
              onClick={() => onVote(true)}
              disabled={isVoting}
              className="flex-1 px-4 py-2 bg-status-success hover:bg-status-success text-white rounded-md transition-colors disabled:opacity-50"
            >
              {isVoting ? 'Submitting...' : 'Vote For'}
            </button>
            <button
              onClick={() => onVote(false)}
              disabled={isVoting}
              className="flex-1 px-4 py-2 bg-status-error hover:bg-status-error text-white rounded-md transition-colors disabled:opacity-50"
            >
              {isVoting ? 'Submitting...' : 'Vote Against'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
