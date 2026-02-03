'use client';

import React from 'react';

interface CloakTypeStepProps {
  cloakMode: 0 | 1 | 2;
  onChange: (mode: 0 | 1 | 2) => void;
}

const CLOAK_MODES = [
  {
    value: 0 as const,
    title: 'Token-Holder',
    description: 'No admin. Token holders vote on everything.',
    detail: 'Standard Governor Bravo pattern. Members join by holding governance tokens. All decisions go through proposals and voting.',
  },
  {
    value: 1 as const,
    title: 'Multisig',
    description: 'Fixed council of signers. M-of-N approval.',
    detail: 'A small group of trusted addresses govern the Cloak. No governance token required. Proposals require M-of-N council approvals.',
  },
  {
    value: 2 as const,
    title: 'Hybrid',
    description: 'Token governance with emergency security council.',
    detail: 'Token holders vote on normal proposals. A security council (elected by token holders) can emergency-execute or cancel malicious proposals.',
  },
];

export function CloakTypeStep({ cloakMode, onChange }: CloakTypeStepProps) {
  return (
    <div className="space-y-4">
      {CLOAK_MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          onClick={() => onChange(mode.value)}
          className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
            cloakMode === mode.value
              ? 'border-accent bg-accent-muted'
              : 'border-border hover:border-border-hover hover:bg-card-hover'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
              cloakMode === mode.value ? 'border-accent' : 'border-foreground-muted'
            }`}>
              {cloakMode === mode.value && (
                <div className="w-2.5 h-2.5 rounded-full bg-accent" />
              )}
            </div>
            <div>
              <div className="font-semibold text-foreground">{mode.title}</div>
              <p className="text-sm text-foreground-secondary mt-0.5">{mode.description}</p>
              <p className="text-xs text-foreground-muted mt-1">{mode.detail}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
