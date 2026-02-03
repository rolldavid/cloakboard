'use client';

import React from 'react';

interface VoteButtonProps {
  label: string;
  variant: 'yes' | 'no' | 'abstain';
  onClick: () => void;
  disabled?: boolean;
}

export function VoteButton({ label, variant, onClick, disabled = false }: VoteButtonProps) {
  const baseStyles = 'flex-1 px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  const variantStyles = {
    yes: 'bg-status-success/10 hover:bg-green-200 text-status-success border border-green-300',
    no: 'bg-status-error/10 hover:bg-red-200 text-status-error border border-red-300',
    abstain: 'bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles[variant]}`}
    >
      {label}
    </button>
  );
}
