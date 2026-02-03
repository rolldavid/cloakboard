'use client';

import React from 'react';
import type {
  TokenGateConfig,
  AztecTokenConfig,
  ERC20TokenConfig,
  MembershipMethod,
} from '@/types/tokenGate';
import {
  DEFAULT_AZTEC_TOKEN_CONFIG,
  DEFAULT_ERC20_TOKEN_CONFIG,
} from '@/types/tokenGate';

interface MembershipMethodStepProps {
  config: TokenGateConfig;
  onChange: (config: TokenGateConfig) => void;
  /** Optional: show email domain field for invite/domain methods */
  showEmailDomain?: boolean;
  emailDomain?: string;
  onEmailDomainChange?: (domain: string) => void;
  /** Optional: restrict which methods are available (e.g., token-only for Governor Bravo) */
  allowedMethods?: MembershipMethod[];
}

export function MembershipMethodStep({
  config,
  onChange,
  showEmailDomain,
  emailDomain,
  onEmailDomainChange,
  allowedMethods,
}: MembershipMethodStepProps) {
  const setMethod = (method: MembershipMethod) => {
    const updated: TokenGateConfig = { ...config, method };
    if (method === 'aztec-token' && !config.aztecToken) {
      updated.aztecToken = { ...DEFAULT_AZTEC_TOKEN_CONFIG };
    }
    if (method === 'erc20-token' && !config.erc20Token) {
      updated.erc20Token = { ...DEFAULT_ERC20_TOKEN_CONFIG };
    }
    onChange(updated);
  };

  const updateAztecToken = (updates: Partial<AztecTokenConfig>) => {
    onChange({
      ...config,
      aztecToken: { ...(config.aztecToken ?? DEFAULT_AZTEC_TOKEN_CONFIG), ...updates },
    });
  };

  const updateErc20Token = (updates: Partial<ERC20TokenConfig>) => {
    onChange({
      ...config,
      erc20Token: { ...(config.erc20Token ?? DEFAULT_ERC20_TOKEN_CONFIG), ...updates },
    });
  };

  return (
    <div className="space-y-4">
      {/* Method Selection Radio Cards */}
      <div className="grid grid-cols-1 gap-3">
        {(!allowedMethods || allowedMethods.includes('invite-only')) && (
          <MethodCard
            selected={config.method === 'invite-only'}
            onSelect={() => setMethod('invite-only')}
            title="Invite Only"
            description="Admin manually adds members"
            icon="shield"
          />
        )}

        {showEmailDomain && (!allowedMethods || allowedMethods.includes('email-domain')) && (
          <MethodCard
            selected={config.method === 'email-domain'}
            onSelect={() => setMethod('email-domain')}
            title="Email Domain"
            description="Verify corporate email to join"
            icon="mail"
          />
        )}

        {(!allowedMethods || allowedMethods.includes('aztec-token')) && (
          <MethodCard
            selected={config.method === 'aztec-token'}
            onSelect={() => setMethod('aztec-token')}
            title="Aztec Token"
            description="Hold an Aztec token to join — fully private balance proof"
            icon="lock"
          />
        )}

        {(!allowedMethods || allowedMethods.includes('erc20-token')) && (
          <MethodCard
            selected={config.method === 'erc20-token'}
            onSelect={() => setMethod('erc20-token')}
            title="ERC20 Token (Ethereum)"
            description="Prove L1 ERC20 holdings via ZK proof — no bridge needed"
            icon="link"
          />
        )}
      </div>

      {/* Email Domain Sub-form */}
      {config.method === 'email-domain' && showEmailDomain && (
        <div className="mt-4 p-4 border border-border rounded-md bg-background-secondary">
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Allowed Email Domain *
          </label>
          <div className="flex items-center">
            <span className="px-3 py-2 bg-background-tertiary border border-r-0 border-border rounded-l-md text-foreground-muted">
              @
            </span>
            <input
              type="text"
              value={emailDomain ?? ''}
              onChange={(e) => onEmailDomainChange?.(e.target.value)}
              placeholder="company.com"
              className="flex-1 px-4 py-2 border border-border rounded-r-md focus:ring-2 focus:ring-ring focus:border-ring"
            />
          </div>
        </div>
      )}

      {/* Aztec Token Sub-form */}
      {config.method === 'aztec-token' && config.aztecToken && (
        <div className="mt-4 p-4 border border-border rounded-md bg-background-secondary space-y-4">
          <div className="flex gap-3">
            <label className="flex items-start gap-2 flex-1 p-3 border border-border rounded-md cursor-pointer hover:border-border-hover">
              <input
                type="radio"
                checked={config.aztecToken.mode === 'create-new'}
                onChange={() => updateAztecToken({ mode: 'create-new' })}
                className="mt-1"
              />
              <div>
                <p className="font-medium text-foreground text-sm">Create Governance Token</p>
                <p className="text-xs text-foreground-muted">Deploy a new token with initial distribution</p>
              </div>
            </label>

            <label className="flex items-start gap-2 flex-1 p-3 border border-border rounded-md cursor-pointer hover:border-border-hover">
              <input
                type="radio"
                checked={config.aztecToken.mode === 'use-existing'}
                onChange={() => updateAztecToken({ mode: 'use-existing' })}
                className="mt-1"
              />
              <div>
                <p className="font-medium text-foreground text-sm">Use Existing Token</p>
                <p className="text-xs text-foreground-muted">Gate with an existing Aztec token</p>
              </div>
            </label>
          </div>

          {config.aztecToken.mode === 'use-existing' && (
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Token Address *
              </label>
              <input
                type="text"
                value={config.aztecToken.existingTokenAddress ?? ''}
                onChange={(e) => updateAztecToken({ existingTokenAddress: e.target.value })}
                placeholder="0x..."
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring font-mono text-sm"
              />
            </div>
          )}

          {config.aztecToken.mode === 'create-new' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">Token Name *</label>
                  <input
                    type="text"
                    value={config.aztecToken.newTokenName ?? ''}
                    onChange={(e) => updateAztecToken({ newTokenName: e.target.value })}
                    placeholder="e.g., Realm Gov Token"
                    maxLength={31}
                    className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1">Symbol *</label>
                  <input
                    type="text"
                    value={config.aztecToken.newTokenSymbol ?? ''}
                    onChange={(e) => updateAztecToken({ newTokenSymbol: e.target.value.toUpperCase() })}
                    placeholder="e.g., RGT"
                    maxLength={10}
                    className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                  />
                </div>
              </div>
              <p className="text-xs text-foreground-muted">
                Configure token distribution and treasury in the next steps.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Min Balance to Join
              </label>
              <input
                type="text"
                value={config.aztecToken.minMembershipBalance}
                onChange={(e) => updateAztecToken({ minMembershipBalance: e.target.value })}
                placeholder="1"
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Min Balance to Propose
              </label>
              <input
                type="text"
                value={config.aztecToken.minProposerBalance}
                onChange={(e) => updateAztecToken({ minProposerBalance: e.target.value })}
                placeholder="100"
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>
          </div>
        </div>
      )}

      {/* ERC20 Token Sub-form */}
      {config.method === 'erc20-token' && config.erc20Token && (
        <div className="mt-4 p-4 border border-border rounded-md bg-background-secondary space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">
              ERC20 Token Address *
            </label>
            <input
              type="text"
              value={config.erc20Token.tokenAddress}
              onChange={(e) => updateErc20Token({ tokenAddress: e.target.value })}
              placeholder="0x..."
              className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-secondary mb-1">Chain</label>
            <select
              value={config.erc20Token.chainId}
              onChange={(e) => updateErc20Token({ chainId: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
            >
              <option value={1}>Ethereum Mainnet</option>
              <option value={8453}>Base</option>
              <option value={11155111}>Sepolia (Testnet)</option>
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('erc20-advanced');
                if (el) el.classList.toggle('hidden');
              }}
              className="text-xs text-foreground-muted hover:text-foreground-secondary transition-colors"
            >
              Advanced settings &rsaquo;
            </button>
            <div id="erc20-advanced" className="hidden mt-3">
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Balance Storage Slot
              </label>
              <input
                type="number"
                min={0}
                value={config.erc20Token.balanceSlot}
                onChange={(e) => updateErc20Token({ balanceSlot: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="text-xs text-foreground-muted mt-1">
                Storage slot for the token&apos;s balances mapping. Default is 0 for most ERC20 tokens.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Min Balance to Join
              </label>
              <input
                type="text"
                value={config.erc20Token.minMembershipBalance}
                onChange={(e) => updateErc20Token({ minMembershipBalance: e.target.value })}
                placeholder="1"
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Min Balance to Propose
              </label>
              <input
                type="text"
                value={config.erc20Token.minProposerBalance}
                onChange={(e) => updateErc20Token({ minProposerBalance: e.target.value })}
                placeholder="100"
                className="w-full px-4 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
            </div>
          </div>

          <div className="p-3 bg-background-tertiary rounded-md">
            <p className="text-xs text-foreground-muted">
              ERC20 verification uses a ZK proof of your Ethereum token balance. Your wallet address and
              exact balance are never revealed — only that you hold at least the minimum amount.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Sub-components =====

interface MethodCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  icon: string;
}

function MethodCard({ selected, onSelect, title, description, icon }: MethodCardProps) {
  const iconMap: Record<string, string> = {
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    mail: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z',
    lock: 'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM7 11V7a5 5 0 0110 0v4',
    link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71',
  };

  return (
    <label
      className={`flex items-start gap-3 p-4 border rounded-md cursor-pointer transition-colors ${
        selected
          ? 'border-ring bg-ring/5 ring-1 ring-ring'
          : 'border-border hover:border-border-hover'
      }`}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="mt-1 sr-only"
      />
      <div className="flex-shrink-0 w-8 h-8 rounded-md bg-background-tertiary flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground-muted"
        >
          <path d={iconMap[icon] ?? iconMap.shield} />
        </svg>
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
      {selected && (
        <div className="ml-auto flex-shrink-0">
          <div className="w-5 h-5 rounded-full bg-ring flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      )}
    </label>
  );
}
