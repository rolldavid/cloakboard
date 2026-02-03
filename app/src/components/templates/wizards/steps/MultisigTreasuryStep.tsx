'use client';

import React from 'react';

interface MultisigTreasuryConfig {
  enabled: boolean;
  amount: string;
  signers: string[];
  threshold: number;
}

interface MultisigTreasuryStepProps {
  config: MultisigTreasuryConfig;
  onChange: (config: MultisigTreasuryConfig) => void;
}

export function MultisigTreasuryStep({ config, onChange }: MultisigTreasuryStepProps) {
  const update = (updates: Partial<MultisigTreasuryConfig>) => {
    onChange({ ...config, ...updates });
  };

  const addSigner = () => {
    if (config.signers.length >= 5) return;
    update({ signers: [...config.signers, ''] });
  };

  const removeSigner = (index: number) => {
    if (config.signers.length <= 1) return;
    const signers = config.signers.filter((_, i) => i !== index);
    const threshold = Math.min(config.threshold, signers.length);
    update({ signers, threshold });
  };

  const updateSigner = (index: number, value: string) => {
    const signers = [...config.signers];
    signers[index] = value;
    update({ signers });
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="rounded"
        />
        <div>
          <p className="font-medium text-foreground text-sm">Create Multisig Treasury</p>
          <p className="text-xs text-foreground-muted">
            Allocate tokens to a multisig wallet requiring multiple approvals to transfer
          </p>
        </div>
      </label>

      {config.enabled && (
        <div className="ml-7 space-y-4 p-4 border border-border rounded-md bg-background-secondary">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Treasury Token Amount
            </label>
            <input
              type="text"
              value={config.amount}
              onChange={(e) => update({ amount: e.target.value })}
              placeholder="50000"
              className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground-secondary">
              Signers ({config.signers.length}/5)
            </label>
            {config.signers.map((signer, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={signer}
                  onChange={(e) => updateSigner(i, e.target.value)}
                  placeholder="Aztec address 0x..."
                  className="flex-1 px-3 py-2 border border-border rounded-md text-sm font-mono focus:ring-1 focus:ring-ring focus:border-ring"
                />
                {config.signers.length > 1 && (
                  <button
                    onClick={() => removeSigner(i)}
                    type="button"
                    className="text-foreground-muted hover:text-status-error px-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {config.signers.length < 5 && (
              <button onClick={addSigner} type="button" className="text-sm text-ring hover:text-ring/80 font-medium">
                + Add Signer
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              Approval Threshold
            </label>
            <select
              value={config.threshold}
              onChange={(e) => update({ threshold: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
            >
              {Array.from({ length: config.signers.length }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} of {config.signers.length} signers required
                </option>
              ))}
            </select>
          </div>

          {parseFloat(config.amount) > 0 && config.signers.length > 0 && (
            <div className="p-3 bg-background-tertiary rounded-md">
              <p className="text-xs text-foreground-muted">
                {parseFloat(config.amount).toLocaleString()} tokens held by{' '}
                {config.threshold}-of-{config.signers.length} multisig
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
