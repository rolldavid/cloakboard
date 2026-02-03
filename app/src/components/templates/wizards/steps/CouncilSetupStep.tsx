'use client';

import React from 'react';

interface CouncilSetupStepProps {
  cloakMode: 1 | 2;
  members: string[];
  threshold: number;
  emergencyThreshold: number;
  onMembersChange: (members: string[]) => void;
  onThresholdChange: (threshold: number) => void;
  onEmergencyThresholdChange: (threshold: number) => void;
}

export function CouncilSetupStep({
  cloakMode,
  members,
  threshold,
  emergencyThreshold,
  onMembersChange,
  onThresholdChange,
  onEmergencyThresholdChange,
}: CouncilSetupStepProps) {
  const addMember = () => {
    if (members.length < 12) {
      onMembersChange([...members, '']);
    }
  };

  const removeMember = (index: number) => {
    if (members.length > 0) {
      const updated = members.filter((_, i) => i !== index);
      onMembersChange(updated.length === 0 ? [''] : updated);
      const validAfter = updated.filter((m) => m.trim().length > 0).length;
      if (threshold > Math.max(validAfter, 1)) onThresholdChange(Math.max(validAfter, 1));
      if (emergencyThreshold > Math.max(validAfter, 1)) onEmergencyThresholdChange(Math.max(validAfter, 1));
    }
  };

  const updateMember = (index: number, value: string) => {
    const updated = [...members];
    updated[index] = value;
    onMembersChange(updated);
  };

  const validCount = members.filter((m) => m.trim().length > 0).length;
  const hasDuplicates = new Set(members.filter((m) => m.trim())).size < validCount;

  return (
    <div className="space-y-6">
      <div className="p-4 bg-status-info/10 border border-status-info/20 rounded-md">
        <p className="text-sm text-status-info">
          {cloakMode === 1
            ? 'Signers are optional at creation. You can skip this step and add Aztec addresses later through governance proposals.'
            : 'Security council members are optional at creation. You can skip this step and add Aztec addresses later through governance proposals.'}
        </p>
      </div>

      {/* Member addresses */}
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-2">
          {cloakMode === 1 ? 'Multisig Signers' : 'Security Council Members'} ({validCount}/12)
        </label>
        <div className="space-y-2">
          {members.map((member, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={member}
                onChange={(e) => updateMember(i, e.target.value)}
                placeholder={`Member ${i + 1} address (0x...)`}
                className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring font-mono text-sm"
              />
              {members.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMember(i)}
                  className="px-3 py-2 text-status-error hover:bg-status-error/10 rounded-md transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
        {members.length < 12 && (
          <button
            type="button"
            onClick={addMember}
            className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors"
          >
            + Add member
          </button>
        )}
        {hasDuplicates && (
          <p className="text-sm text-status-error mt-1">Duplicate addresses detected</p>
        )}
      </div>

      {/* Threshold — only show when there are valid members */}
      {validCount > 0 && (
        <>
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Approval Threshold: {threshold} of {validCount}
            </label>
            <input
              type="range"
              min={1}
              max={Math.max(validCount, 1)}
              value={threshold}
              onChange={(e) => onThresholdChange(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-foreground-muted mt-1">
              {cloakMode === 1
                ? 'Number of signers required to approve proposals'
                : 'Number of council members needed to cancel malicious proposals'}
            </p>
          </div>

          {/* Emergency threshold (mode 2 only) */}
          {cloakMode === 2 && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Emergency Threshold: {emergencyThreshold} of {validCount}
              </label>
              <input
                type="range"
                min={1}
                max={Math.max(validCount, 1)}
                value={emergencyThreshold}
                onChange={(e) => onEmergencyThresholdChange(parseInt(e.target.value))}
                className="w-full"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Higher threshold required to emergency-execute proposals (bypasses timelock)
              </p>
            </div>
          )}
        </>
      )}

      {/* Summary */}
      <div className="p-4 bg-background-secondary border border-border rounded-md">
        <h4 className="font-medium text-foreground mb-2">
          {cloakMode === 1 ? 'Multisig' : 'Security Council'} Configuration
        </h4>
        {validCount > 0 ? (
          <p className="text-sm text-foreground-secondary">
            {validCount} member{validCount !== 1 ? 's' : ''}, {threshold}-of-{validCount} required for approval
            {cloakMode === 2 && `, ${emergencyThreshold}-of-${validCount} for emergency actions`}
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">
            No members configured. Council members can be added later via governance proposals.
          </p>
        )}
      </div>
    </div>
  );
}
