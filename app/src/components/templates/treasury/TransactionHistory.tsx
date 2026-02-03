'use client';

import React, { useState, useMemo } from 'react';

type TransactionType = 'inflow' | 'outflow' | 'internal';
type TransactionStatus = 'pending' | 'confirmed' | 'failed';

interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  from: string;
  to: string;
  amount: bigint;
  tokenSymbol: string;
  decimals: number;
  timestamp: Date;
  description?: string;
  txHash?: string;
  proposalId?: string;
}

interface TransactionHistoryProps {
  transactions: Transaction[];
  isLoading?: boolean;
  onViewProposal?: (proposalId: string) => void;
}

const TYPE_CONFIG: Record<TransactionType, { label: string; color: string; icon: React.ReactNode }> = {
  inflow: {
    label: 'Received',
    color: 'text-status-success',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
  },
  outflow: {
    label: 'Sent',
    color: 'text-status-error',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ),
  },
  internal: {
    label: 'Internal',
    color: 'text-status-info',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
};

const STATUS_CONFIG: Record<TransactionStatus, { label: string; bgColor: string; textColor: string }> = {
  pending: { label: 'Pending', bgColor: 'bg-status-warning/10', textColor: 'text-status-warning' },
  confirmed: { label: 'Confirmed', bgColor: 'bg-status-success/10', textColor: 'text-status-success' },
  failed: { label: 'Failed', bgColor: 'bg-status-error/10', textColor: 'text-status-error' },
};

const ITEMS_PER_PAGE = 10;

export function TransactionHistory({
  transactions,
  isLoading = false,
  onViewProposal,
}: TransactionHistoryProps) {
  const [typeFilter, setTypeFilter] = useState<TransactionType | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      return true;
    });
  }, [transactions, typeFilter]);

  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredTransactions.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredTransactions, currentPage]);

  const formatAmount = (amount: bigint, decimals: number) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    const fractionalPart = amount % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 4);
    return `${integerPart.toLocaleString()}.${fractionalStr}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card border border-border rounded-md p-4 animate-shimmer">
            <div className="flex justify-between">
              <div className="h-5 bg-background-tertiary rounded w-1/3" />
              <div className="h-5 bg-background-tertiary rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as TransactionType | 'all');
            setCurrentPage(1);
          }}
          className="px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
        >
          <option value="all">All Transactions</option>
          <option value="inflow">Received</option>
          <option value="outflow">Sent</option>
          <option value="internal">Internal</option>
        </select>
      </div>

      {/* Transaction List */}
      {paginatedTransactions.length === 0 ? (
        <div className="bg-card border border-border rounded-md p-8 text-center">
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-foreground-secondary">No transactions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedTransactions.map((tx) => {
            const typeConfig = TYPE_CONFIG[tx.type];
            const statusConfig = STATUS_CONFIG[tx.status];

            return (
              <div
                key={tx.id}
                className="bg-card border border-border rounded-md p-4 hover:border-border-hover transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full bg-background-tertiary ${typeConfig.color}`}>
                      {typeConfig.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{typeConfig.label}</p>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.textColor}`}
                        >
                          {statusConfig.label}
                        </span>
                      </div>
                      <p className="text-sm text-foreground-muted">
                        {tx.type === 'outflow' ? 'To' : 'From'}: {tx.type === 'outflow' ? tx.to : tx.from}
                      </p>
                      {tx.description && (
                        <p className="text-sm text-foreground-muted mt-1">{tx.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={`font-semibold ${typeConfig.color}`}>
                      {tx.type === 'outflow' ? '-' : '+'}{formatAmount(tx.amount, tx.decimals)} {tx.tokenSymbol}
                    </p>
                    <p className="text-sm text-foreground-muted">{formatDate(tx.timestamp)}</p>
                    {tx.proposalId && onViewProposal && (
                      <button
                        onClick={() => onViewProposal(tx.proposalId!)}
                        className="text-xs text-accent hover:text-accent mt-1"
                      >
                        View Proposal
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-4">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 border border-border-hover rounded-md hover:bg-card-hover disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-foreground-secondary">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 border border-border-hover rounded-md hover:bg-card-hover disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
