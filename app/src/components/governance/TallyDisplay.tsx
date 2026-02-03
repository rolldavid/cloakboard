'use client';

import React from 'react';

interface TallyDisplayProps {
  yesVotes: bigint;
  noVotes: bigint;
  abstainVotes: bigint;
  totalVotes: bigint;
}

export function TallyDisplay({ yesVotes, noVotes, abstainVotes, totalVotes }: TallyDisplayProps) {
  const total = Number(totalVotes);
  const yes = Number(yesVotes);
  const no = Number(noVotes);
  const abstain = Number(abstainVotes);

  const yesPercentage = total > 0 ? (yes / total) * 100 : 0;
  const noPercentage = total > 0 ? (no / total) * 100 : 0;
  const abstainPercentage = total > 0 ? (abstain / total) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-foreground-secondary">Total Votes</span>
        <span className="font-medium">{total}</span>
      </div>

      {/* Progress Bar */}
      <div className="h-3 bg-background-tertiary rounded-full overflow-hidden flex">
        <div
          className="bg-green-500 transition-all"
          style={{ width: `${yesPercentage}%` }}
        />
        <div
          className="bg-red-500 transition-all"
          style={{ width: `${noPercentage}%` }}
        />
        <div
          className="bg-gray-400 transition-all"
          style={{ width: `${abstainPercentage}%` }}
        />
      </div>

      {/* Vote Counts */}
      <div className="flex justify-between text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded-full" />
          <span className="text-status-success">Yes: {yes}</span>
          <span className="text-foreground-muted">({yesPercentage.toFixed(1)}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-gray-400 rounded-full" />
          <span className="text-gray-500">Abstain: {abstain}</span>
          <span className="text-foreground-muted">({abstainPercentage.toFixed(1)}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-foreground-muted">({noPercentage.toFixed(1)}%)</span>
          <span className="text-status-error">No: {no}</span>
          <div className="w-3 h-3 bg-red-500 rounded-full" />
        </div>
      </div>
    </div>
  );
}
