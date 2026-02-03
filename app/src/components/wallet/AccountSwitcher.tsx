'use client';

/**
 * Account Switcher Component
 *
 * Allows users to view all accounts, switch between them,
 * and add new derived accounts from the same mnemonic.
 */

import React, { useState } from 'react';
import { useWallet, useAccounts } from '@/lib/hooks/useWallet';

interface AccountSwitcherProps {
  onAccountChange?: (address: string) => void;
  className?: string;
}

export function AccountSwitcher({ onAccountChange, className }: AccountSwitcherProps) {
  const { state, switchAccountByIndex, addAccount, isLoading, error } = useWallet();
  const accounts = useAccounts();

  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newAccountAlias, setNewAccountAlias] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSwitchAccount = async (index: number) => {
    if (index === state.accountIndex) {
      setIsOpen(false);
      return;
    }

    setLocalError(null);
    try {
      await switchAccountByIndex(index);
      const account = accounts[index];
      if (account) {
        onAccountChange?.(account.address);
      }
      setIsOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to switch account');
    }
  };

  const handleAddAccount = async () => {
    if (!newAccountAlias.trim()) {
      setLocalError('Please enter an account name');
      return;
    }

    setLocalError(null);
    setIsAdding(true);

    try {
      const newAccount = await addAccount(newAccountAlias.trim());
      setNewAccountAlias('');
      // Switch to the new account
      await switchAccountByIndex(newAccount.index);
      onAccountChange?.(newAccount.address);
      setIsOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setIsAdding(false);
    }
  };

  const currentAccount = accounts.find(a => a.address === state.address);

  if (!state.address || accounts.length === 0) {
    return null;
  }

  return (
    <div className={`relative ${className || ''}`}>
      {/* Current Account Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-background-tertiary hover:bg-background-tertiary rounded-md transition-colors"
      >
        <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-white text-sm font-medium">
          {(currentAccount?.alias || 'A')[0].toUpperCase()}
        </div>
        <div className="text-left">
          <p className="text-sm font-medium text-foreground">
            {currentAccount?.alias || `Account ${state.accountIndex + 1}`}
          </p>
          <p className="text-xs text-foreground-muted font-mono">
            {state.address.slice(0, 6)}...{state.address.slice(-4)}
          </p>
        </div>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-card border border-border rounded-md shadow-lg z-50">
          <div className="p-2">
            <p className="px-2 py-1 text-xs text-foreground-muted uppercase tracking-wide">
              Accounts ({accounts.length})
            </p>

            {/* Account List */}
            <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
              {accounts.map((account, index) => (
                <button
                  key={account.address}
                  onClick={() => handleSwitchAccount(index)}
                  disabled={isLoading}
                  className={`w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors ${
                    account.address === state.address
                      ? 'bg-accent-muted border border-accent'
                      : 'hover:bg-card-hover'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${
                      account.address === state.address ? 'bg-accent' : 'bg-foreground-muted'
                    }`}
                  >
                    {account.alias[0].toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-foreground">{account.alias}</p>
                    <p className="text-xs text-foreground-muted font-mono">
                      {account.address.slice(0, 8)}...{account.address.slice(-6)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {account.isDeployed ? (
                      <span className="w-2 h-2 bg-status-success rounded-full" title="Deployed" />
                    ) : (
                      <span className="w-2 h-2 bg-status-warning rounded-full" title="Not deployed" />
                    )}
                    {account.address === state.address && (
                      <svg className="w-4 h-4 text-accent" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Add Account Section */}
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newAccountAlias}
                  onChange={(e) => setNewAccountAlias(e.target.value)}
                  placeholder="New account name"
                  className="flex-1 px-3 py-2 text-sm border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddAccount();
                    }
                  }}
                />
                <button
                  onClick={handleAddAccount}
                  disabled={isAdding || isLoading}
                  className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors disabled:opacity-50"
                >
                  {isAdding ? '...' : 'Add'}
                </button>
              </div>
            </div>

            {/* Error Display */}
            {(localError || error) && (
              <div className="mt-2 p-2 bg-status-error/10 border border-status-error text-status-error rounded-md text-xs">
                {localError || error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
