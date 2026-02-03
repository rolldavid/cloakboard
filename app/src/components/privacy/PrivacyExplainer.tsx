'use client';

import React, { useState } from 'react';
import type { PrivacySettings } from '@/types/privacy';
import { VISIBILITY_LABELS } from '@/types/privacy';

interface PrivacyExplainerProps {
  settings: PrivacySettings;
  showDetailed?: boolean;
}

interface SettingRowProps {
  label: string;
  value: string;
  level: 'private' | 'partial' | 'public';
}

function SettingRow({ label, value, level }: SettingRowProps) {
  const levelClasses = {
    private: 'bg-template-rose/10 text-privacy-maximum',
    partial: 'bg-template-amber/10 text-accent',
    public: 'bg-template-emerald/10 text-privacy-transparent',
  };

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground-secondary">{label}</span>
      <span className={`px-2 py-0.5 text-xs rounded-full ${levelClasses[level]}`}>{value}</span>
    </div>
  );
}

/**
 * Detailed breakdown of privacy settings
 */
export function PrivacyExplainer({ settings, showDetailed = false }: PrivacyExplainerProps) {
  const [expanded, setExpanded] = useState(showDetailed);

  const getVisibilityLevel = (value: string): 'private' | 'partial' | 'public' => {
    if (value.includes('hidden') || value.includes('never') || value === 'none' || value === 'silent') {
      return 'private';
    }
    if (value.includes('public') || value.includes('exact') || value.includes('full') || value.includes('detailed')) {
      return 'public';
    }
    return 'partial';
  };

  const formatValue = (value: string): string => {
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 bg-background-secondary hover:bg-card-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <span className="font-medium text-foreground">Privacy Settings Details</span>
        </div>
        <svg
          className={`w-5 h-5 text-foreground-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-4 divide-y divide-border">
          {/* Membership */}
          <div className="pb-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Membership</h4>
            <div className="space-y-1">
              <SettingRow
                label="Member List"
                value={VISIBILITY_LABELS[settings.membership.memberList]}
                level={getVisibilityLevel(settings.membership.memberList)}
              />
              <SettingRow
                label="Member Count"
                value={formatValue(settings.membership.memberCount)}
                level={getVisibilityLevel(settings.membership.memberCount)}
              />
              <SettingRow
                label="Join Announcements"
                value={formatValue(settings.membership.joinAnnouncements)}
                level={getVisibilityLevel(settings.membership.joinAnnouncements)}
              />
            </div>
          </div>

          {/* Voting */}
          <div className="py-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Voting</h4>
            <div className="space-y-1">
              <SettingRow
                label="Vote Choices"
                value={formatValue(settings.voting.voteChoice)}
                level={getVisibilityLevel(settings.voting.voteChoice)}
              />
              <SettingRow
                label="Live Tally"
                value={formatValue(settings.voting.liveTally)}
                level={getVisibilityLevel(settings.voting.liveTally)}
              />
              <SettingRow
                label="Voter Identity"
                value={formatValue(settings.voting.voterIdentity)}
                level={getVisibilityLevel(settings.voting.voterIdentity)}
              />
              <SettingRow
                label="Voting Power"
                value={formatValue(settings.voting.votingPower)}
                level={getVisibilityLevel(settings.voting.votingPower)}
              />
            </div>
          </div>

          {/* Proposals */}
          <div className="py-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Proposals</h4>
            <div className="space-y-1">
              <SettingRow
                label="Author Visibility"
                value={formatValue(settings.proposals.authorVisibility)}
                level={getVisibilityLevel(settings.proposals.authorVisibility)}
              />
              <SettingRow
                label="Content Visibility"
                value={VISIBILITY_LABELS[settings.proposals.contentVisibility]}
                level={getVisibilityLevel(settings.proposals.contentVisibility)}
              />
              <SettingRow
                label="Discussions"
                value={formatValue(settings.proposals.discussions)}
                level={getVisibilityLevel(settings.proposals.discussions)}
              />
            </div>
          </div>

          {/* Treasury */}
          <div className="py-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Treasury</h4>
            <div className="space-y-1">
              <SettingRow
                label="Balance"
                value={formatValue(settings.treasury.balance)}
                level={getVisibilityLevel(settings.treasury.balance)}
              />
              <SettingRow
                label="Transactions"
                value={formatValue(settings.treasury.transactions)}
                level={getVisibilityLevel(settings.treasury.transactions)}
              />
              <SettingRow
                label="Recipients"
                value={formatValue(settings.treasury.recipients)}
                level={getVisibilityLevel(settings.treasury.recipients)}
              />
            </div>
          </div>

          {/* Activity */}
          <div className="pt-4">
            <h4 className="text-sm font-medium text-foreground mb-2">Activity</h4>
            <div className="space-y-1">
              <SettingRow
                label="Activity Feed"
                value={formatValue(settings.activity.feed)}
                level={getVisibilityLevel(settings.activity.feed)}
              />
            </div>
          </div>

          {/* Legend */}
          <div className="pt-4 mt-4 border-t border-border">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-foreground-muted">Legend:</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                Private
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                Partial
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Public
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
