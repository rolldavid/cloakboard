'use client';

import React, { useState } from 'react';

interface PendingMember {
  address: string;
  requestedAt: Date;
  email?: string;
  message?: string;
  referredBy?: string;
}

interface PendingMemberQueueProps {
  pendingMembers: PendingMember[];
  onApprove: (address: string) => Promise<void>;
  onReject: (address: string) => Promise<void>;
  isLoading?: boolean;
}

export function PendingMemberQueue({
  pendingMembers,
  onApprove,
  onReject,
  isLoading = false,
}: PendingMemberQueueProps) {
  const [processingAddress, setProcessingAddress] = useState<string | null>(null);
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null);

  const handleApprove = async (address: string) => {
    setProcessingAddress(address);
    try {
      await onApprove(address);
    } finally {
      setProcessingAddress(null);
    }
  };

  const handleReject = async (address: string) => {
    setProcessingAddress(address);
    try {
      await onReject(address);
    } finally {
      setProcessingAddress(null);
    }
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    const minutes = Math.floor(diff / (1000 * 60));
    return `${minutes}m ago`;
  };

  if (pendingMembers.length === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-6 text-center">
        <svg
          className="w-12 h-12 text-foreground-muted mx-auto mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <p className="text-foreground-secondary font-medium">No pending requests</p>
        <p className="text-sm text-foreground-muted mt-1">
          New member requests will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">
          Pending Member Requests
          <span className="ml-2 px-2 py-0.5 text-sm bg-status-warning/10 text-status-warning rounded-full">
            {pendingMembers.length}
          </span>
        </h3>
      </div>

      <div className="space-y-3">
        {pendingMembers.map((member) => {
          const isProcessing = processingAddress === member.address;
          const isExpanded = expandedAddress === member.address;

          return (
            <div
              key={member.address}
              className="bg-card border border-border rounded-md overflow-hidden"
            >
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white font-medium">
                      {member.address.slice(2, 4).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        {member.address.slice(0, 6)}...{member.address.slice(-4)}
                      </p>
                      <p className="text-sm text-foreground-muted">
                        Requested {formatTimeAgo(member.requestedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {member.message && (
                      <button
                        onClick={() => setExpandedAddress(isExpanded ? null : member.address)}
                        className="p-2 text-foreground-muted hover:text-foreground-secondary"
                        title="View message"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                          />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => handleReject(member.address)}
                      disabled={isProcessing || isLoading}
                      className="px-3 py-1.5 text-sm text-status-error hover:bg-status-error/10 rounded-md transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(member.address)}
                      disabled={isProcessing || isLoading}
                      className="px-3 py-1.5 text-sm bg-status-success hover:bg-status-success text-white rounded-md transition-colors disabled:opacity-50"
                    >
                      {isProcessing ? 'Processing...' : 'Approve'}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-border">
                    {member.email && (
                      <p className="text-sm text-foreground-secondary mb-2">
                        <span className="font-medium">Email:</span> {member.email}
                      </p>
                    )}
                    {member.referredBy && (
                      <p className="text-sm text-foreground-secondary mb-2">
                        <span className="font-medium">Referred by:</span>{' '}
                        {member.referredBy.slice(0, 6)}...{member.referredBy.slice(-4)}
                      </p>
                    )}
                    {member.message && (
                      <div className="bg-background-secondary rounded-md p-3">
                        <p className="text-sm text-foreground-secondary">{member.message}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
