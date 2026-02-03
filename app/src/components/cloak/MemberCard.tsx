'use client';

import React from 'react';
import { Crown, Shield, Target, User } from 'lucide-react';

export type MemberRole = 'admin' | 'member' | 'delegate' | 'guardian';

/**
 * Represents a user who has taken a public action (posted, proposed, etc.)
 * and thus voluntarily revealed their display name.
 */
export interface RevealedMember {
  address: string;
  displayName: string | null;
  role: MemberRole;
  isCurrentUser?: boolean;
}

interface MemberCardProps {
  member: RevealedMember;
  /** Discussion privacy level: 0=anonymous, 1=display name, 2=display name + role */
  discussionPrivacy?: number;
  onChangeRole?: (newRole: MemberRole) => void;
  isAdmin?: boolean;
}

const ROLE_CONFIG: Record<MemberRole, { label: string; bgColor: string; textColor: string; icon: React.ReactNode }> = {
  admin: {
    label: 'Admin',
    bgColor: 'bg-template-purple/10',
    textColor: 'text-template-purple',
    icon: <Crown className="w-3 h-3" />,
  },
  guardian: {
    label: 'Guardian',
    bgColor: 'bg-status-info/10',
    textColor: 'text-status-info',
    icon: <Shield className="w-3 h-3" />,
  },
  delegate: {
    label: 'Delegate',
    bgColor: 'bg-status-success/10',
    textColor: 'text-status-success',
    icon: <Target className="w-3 h-3" />,
  },
  member: {
    label: 'Member',
    bgColor: 'bg-background-tertiary',
    textColor: 'text-foreground-secondary',
    icon: <User className="w-3 h-3" />,
  },
};

/**
 * Displays a poster's identity on comments/proposals.
 *
 * Privacy behavior:
 * - discussionPrivacy=0: shows "Anonymous"
 * - discussionPrivacy=1: shows display name (from account contract)
 * - discussionPrivacy=2: shows display name + role badge
 */
export function MemberCard({
  member,
  discussionPrivacy = 1,
  onChangeRole,
  isAdmin = false,
}: MemberCardProps) {
  const roleConfig = ROLE_CONFIG[member.role];

  // Determine what to display based on discussion privacy level
  const displayIdentity = React.useMemo(() => {
    if (discussionPrivacy === 0) {
      return 'Anonymous';
    }
    return member.displayName || `${member.address.slice(0, 6)}...${member.address.slice(-4)}`;
  }, [discussionPrivacy, member.displayName, member.address]);

  const avatarLetter = React.useMemo(() => {
    if (discussionPrivacy === 0) return '?';
    if (member.displayName) return member.displayName.charAt(0).toUpperCase();
    return member.address.slice(2, 4).toUpperCase();
  }, [discussionPrivacy, member.displayName, member.address]);

  return (
    <div
      className={`bg-card border rounded-md p-4 transition-colors ${
        member.isCurrentUser ? 'border-accent bg-accent-muted/30' : 'border-border hover:border-border-hover'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-medium">
            {avatarLetter}
          </div>

          <div>
            {/* Display Name */}
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground">{displayIdentity}</p>
              {member.isCurrentUser && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent-muted text-accent">
                  You
                </span>
              )}
            </div>

            {/* Role Badge (only shown when discussionPrivacy >= 2) */}
            {discussionPrivacy >= 2 && (
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded-full flex items-center gap-1 ${roleConfig.bgColor} ${roleConfig.textColor}`}
                >
                  {roleConfig.icon} {roleConfig.label}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin actions */}
      {isAdmin && onChangeRole && !member.isCurrentUser && discussionPrivacy >= 1 && (
        <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-2">
          <select
            value={member.role}
            onChange={(e) => onChangeRole(e.target.value as MemberRole)}
            className="px-3 py-1.5 text-sm border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          >
            <option value="member">Member</option>
            <option value="delegate">Delegate</option>
            <option value="guardian">Guardian</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      )}
    </div>
  );
}
