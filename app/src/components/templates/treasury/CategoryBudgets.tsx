'use client';

import React from 'react';

interface CategoryBudget {
  name: string;
  allocated: bigint;
  spent: bigint;
  remaining: bigint;
  decimals: number;
  tokenSymbol: string;
  color: string;
}

interface CategoryBudgetsProps {
  categories: CategoryBudget[];
  totalBudget?: bigint;
  isLoading?: boolean;
}

export function CategoryBudgets({
  categories,
  totalBudget,
  isLoading = false,
}: CategoryBudgetsProps) {
  const formatAmount = (amount: bigint, decimals: number) => {
    const divisor = 10n ** BigInt(decimals);
    const integerPart = amount / divisor;
    return integerPart.toLocaleString();
  };

  const getPercentage = (spent: bigint, allocated: bigint) => {
    if (allocated === 0n) return 0;
    return Number((spent * 100n) / allocated);
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-md p-6 animate-shimmer">
        <div className="h-6 bg-background-tertiary rounded w-1/3 mb-4" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-4 bg-background-tertiary rounded w-1/4 mb-2" />
              <div className="h-3 bg-background-tertiary rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">Budget Allocation</h3>
        {totalBudget !== undefined && categories.length > 0 && (
          <span className="text-sm text-foreground-muted">
            Total: {formatAmount(totalBudget, categories[0].decimals)} {categories[0].tokenSymbol}
          </span>
        )}
      </div>

      {categories.length === 0 ? (
        <div className="text-center py-8 text-foreground-muted">
          <p>No budget categories defined</p>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((category) => {
            const percentage = getPercentage(category.spent, category.allocated);
            const isOverBudget = category.spent > category.allocated;

            return (
              <div key={category.name}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="font-medium text-foreground">{category.name}</span>
                  </div>
                  <div className="text-sm text-right">
                    <span className={isOverBudget ? 'text-status-error font-medium' : 'text-foreground-secondary'}>
                      {formatAmount(category.spent, category.decimals)}
                    </span>
                    <span className="text-foreground-muted"> / </span>
                    <span className="text-foreground-secondary">
                      {formatAmount(category.allocated, category.decimals)} {category.tokenSymbol}
                    </span>
                  </div>
                </div>

                <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all rounded-full ${
                      isOverBudget ? 'bg-status-error' : percentage > 80 ? 'bg-status-warning' : ''
                    }`}
                    style={{
                      width: `${Math.min(percentage, 100)}%`,
                      backgroundColor: !isOverBudget && percentage <= 80 ? category.color : undefined,
                    }}
                  />
                </div>

                <div className="flex justify-between mt-1">
                  <span className="text-xs text-foreground-muted">
                    {percentage.toFixed(1)}% used
                  </span>
                  <span className={`text-xs ${isOverBudget ? 'text-status-error' : 'text-foreground-muted'}`}>
                    {isOverBudget ? 'Over budget by ' : 'Remaining: '}
                    {formatAmount(
                      isOverBudget ? category.spent - category.allocated : category.remaining,
                      category.decimals
                    )}{' '}
                    {category.tokenSymbol}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
