'use client';

import React from 'react';

interface SecurityCouncilPanelProps {
  councilMembers: string[];
  councilThreshold: number;
  emergencyThreshold: number;
  onProposeElection?: () => void;
}

export function SecurityCouncilPanel({
  councilMembers,
  councilThreshold,
  emergencyThreshold,
  onProposeElection,
}: SecurityCouncilPanelProps) {
  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Security Council</h3>
          <p className="text-sm text-foreground-muted mt-1">
            {councilThreshold}-of-{councilMembers.length} for cancellation, {emergencyThreshold}-of-{councilMembers.length} for emergency execution
          </p>
        </div>
        {onProposeElection && (
          <button
            onClick={onProposeElection}
            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          >
            Propose Election
          </button>
        )}
      </div>

      <div className="space-y-2">
        {councilMembers.map((member, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-2 bg-background-secondary rounded-md"
          >
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-medium text-accent">
              {i + 1}
            </div>
            <span className="font-mono text-sm text-foreground-secondary truncate">
              {member}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-foreground-muted mt-4">
        Council members can only be changed via governance proposals.
      </p>
    </div>
  );
}
