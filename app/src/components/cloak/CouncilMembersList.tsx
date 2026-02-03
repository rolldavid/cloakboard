'use client';

import React from 'react';

interface CouncilMembersListProps {
  members: string[];
  threshold: number;
}

export function CouncilMembersList({ members, threshold }: CouncilMembersListProps) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Council Members</h2>
        <div className="text-sm text-foreground-muted px-3 py-1.5 bg-background-tertiary rounded-md">
          {threshold} of {members.length} required
        </div>
      </div>

      <div className="space-y-2">
        {members.map((member, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 bg-card border border-border rounded-md"
          >
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-medium text-accent">
              {i + 1}
            </div>
            <span className="font-mono text-sm text-foreground flex-1 truncate">
              {member}
            </span>
          </div>
        ))}

        {members.length === 0 && (
          <div className="p-4 text-center text-foreground-muted bg-card border border-border rounded-md">
            No council members configured.
          </div>
        )}
      </div>

      <p className="text-xs text-foreground-muted">
        Council members can only be changed via governance proposals.
      </p>
    </div>
  );
}
