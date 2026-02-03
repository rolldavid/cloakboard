'use client';

import React, { useState } from 'react';

interface TokenOption {
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
}

interface SpendingProposalFormProps {
  tokens: TokenOption[];
  categories?: string[];
  onSubmit: (proposal: {
    title: string;
    description: string;
    recipient: string;
    tokenSymbol: string;
    amount: bigint;
    category?: string;
  }) => Promise<void>;
  isLoading?: boolean;
  onCancel?: () => void;
}

export function SpendingProposalForm({
  tokens,
  categories = ['Operations', 'Development', 'Marketing', 'Community', 'Other'],
  onSubmit,
  isLoading = false,
  onCancel,
}: SpendingProposalFormProps) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    recipient: '',
    tokenSymbol: tokens[0]?.symbol || '',
    amount: '',
    category: categories[0] || '',
  });

  const selectedToken = tokens.find((t) => t.symbol === form.tokenSymbol);

  const formatBalance = (balance: bigint, decimals: number) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = balance / divisor;
    return integerPart.toLocaleString();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedToken) return;

    const amountBigInt = BigInt(Math.floor(parseFloat(form.amount) * 10 ** selectedToken.decimals));

    await onSubmit({
      title: form.title,
      description: form.description,
      recipient: form.recipient,
      tokenSymbol: form.tokenSymbol,
      amount: amountBigInt,
      category: form.category,
    });
  };

  const isOverBudget = () => {
    if (!selectedToken || !form.amount) return false;
    try {
      const amountBigInt = BigInt(Math.floor(parseFloat(form.amount) * 10 ** selectedToken.decimals));
      return amountBigInt > selectedToken.balance;
    } catch {
      return false;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Proposal Title
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
          placeholder="e.g., Q1 Marketing Budget"
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          required
          rows={3}
          placeholder="Explain why this spending is needed..."
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Category
          </label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-secondary mb-1">
            Token
          </label>
          <select
            value={form.tokenSymbol}
            onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value })}
            className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
          >
            {tokens.map((token) => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol} ({formatBalance(token.balance, token.decimals)} available)
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Amount
        </label>
        <div className="relative">
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
            min="0"
            step="any"
            placeholder="0.00"
            className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-ring focus:border-ring ${
              isOverBudget() ? 'border-border-hover bg-status-error/10' : 'border-border-hover'
            }`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted">
            {form.tokenSymbol}
          </span>
        </div>
        {isOverBudget() && (
          <p className="mt-1 text-sm text-status-error">
            Amount exceeds available balance
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground-secondary mb-1">
          Recipient Address
        </label>
        <input
          type="text"
          value={form.recipient}
          onChange={(e) => setForm({ ...form, recipient: e.target.value })}
          required
          placeholder="0x..."
          className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-foreground-secondary hover:text-foreground"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isLoading || !form.title || !form.recipient || !form.amount || isOverBudget()}
          className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Creating...' : 'Create Proposal'}
        </button>
      </div>
    </form>
  );
}
