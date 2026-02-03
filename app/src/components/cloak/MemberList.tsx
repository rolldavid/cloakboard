'use client';

import React from 'react';
import { useWalletContext } from '../wallet/WalletProvider';
import { CouncilMembersList } from './CouncilMembersList';
import { SecurityCouncilPanel } from './SecurityCouncilPanel';

interface MemberListProps {
  cloakAddress: string;
  memberCount?: number;
  isCurrentUserMember?: boolean;
  isAdmin?: boolean;
  /** Cloak mode: 0 = token-holder, 1 = multisig, 2 = hybrid */
  cloakMode?: number;
  councilMembers?: string[];
  councilThreshold?: number;
  emergencyThreshold?: number;
}

/**
 * Member list component.
 *
 * Member lists are always private — nobody can see who is a member.
 * This component shows:
 * - Member count (approximate or exact per priv_member_count setting)
 * - The current user's own membership status
 * - For multisig/hybrid modes: council member info (those are public by design)
 */
export function MemberList({
  cloakAddress,
  memberCount = 0,
  isCurrentUserMember = false,
  isAdmin = false,
  cloakMode = 0,
  councilMembers = [],
  councilThreshold = 1,
  emergencyThreshold = 0,
}: MemberListProps) {
  const { account } = useWalletContext();

  // Mode 1: Multisig — council members are public by design
  if (cloakMode === 1) {
    return (
      <CouncilMembersList
        members={councilMembers}
        threshold={councilThreshold}
      />
    );
  }

  // Mode 2: Hybrid — show council panel + private member count
  if (cloakMode === 2) {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Members</h2>
          <div className="bg-card border border-border rounded-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground-muted">Member Count</p>
                <p className="text-2xl font-semibold text-foreground">
                  {memberCount > 0 ? `~${memberCount}` : 'Hidden'}
                </p>
              </div>
              {isCurrentUserMember && (
                <span className="px-3 py-1.5 text-sm font-medium rounded-full bg-accent-muted text-accent">
                  You are a member
                </span>
              )}
            </div>
            <p className="text-sm text-foreground-muted mt-4">
              Member identities are private. Members are only revealed when they
              voluntarily take public actions like posting comments or proposals.
            </p>
          </div>
        </div>
        <SecurityCouncilPanel
          councilMembers={councilMembers}
          councilThreshold={councilThreshold}
          emergencyThreshold={emergencyThreshold}
        />
      </div>
    );
  }

  // Default: private member list with count only
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Members</h2>

      <div className="bg-card border border-border rounded-md">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-foreground-muted">Member Count</p>
              <p className="text-2xl font-semibold text-foreground">
                {memberCount > 0 ? `~${memberCount}` : 'Hidden'}
              </p>
            </div>
            {isCurrentUserMember && (
              <span className="px-3 py-1.5 text-sm font-medium rounded-full bg-accent-muted text-accent">
                You are a member
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 p-4 bg-background-tertiary rounded-md">
            <svg
              className="w-8 h-8 text-foreground-muted flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <div>
              <p className="font-medium text-foreground">Member list is private</p>
              <p className="text-sm text-foreground-muted mt-0.5">
                Member identities are never exposed. When a member posts a comment
                or creates a proposal, their display name appears on that action only.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
