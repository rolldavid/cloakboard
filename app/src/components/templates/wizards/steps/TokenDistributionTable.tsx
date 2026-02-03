'use client';

import React from 'react';

interface DistributionRow {
  address: string;
  amount: string;
}

interface TokenDistributionTableProps {
  rows: DistributionRow[];
  onChange: (rows: DistributionRow[]) => void;
  /** Auto-fill first row with creator address */
  creatorAddress?: string;
}

export function TokenDistributionTable({ rows, onChange, creatorAddress }: TokenDistributionTableProps) {
  const hasAutoFilled = React.useRef(false);

  React.useEffect(() => {
    if (!hasAutoFilled.current && creatorAddress && rows.length > 0 && !rows[0].address) {
      hasAutoFilled.current = true;
      const updated = [...rows];
      updated[0] = { ...updated[0], address: creatorAddress };
      onChange(updated);
    }
  }, [creatorAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRow = () => {
    onChange([...rows, { address: '', amount: '' }]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof DistributionRow, value: string) => {
    const updated = [...rows];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const totalSupply = rows.reduce((sum, row) => {
    const amount = parseFloat(row.amount) || 0;
    return sum + amount;
  }, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground-secondary">Initial Token Distribution</h4>
        <span className="text-xs text-foreground-muted">
          Total Supply: {totalSupply.toLocaleString()} tokens
        </span>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background-tertiary">
              <th className="text-left text-xs font-medium text-foreground-muted px-3 py-2">Aztec Address</th>
              <th className="text-left text-xs font-medium text-foreground-muted px-3 py-2 w-36">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={row.address}
                    onChange={(e) => updateRow(i, 'address', e.target.value)}
                    placeholder={i === 0 && creatorAddress ? creatorAddress : '0x...'}
                    className="w-full px-2 py-1 border border-border rounded text-sm font-mono focus:ring-1 focus:ring-ring focus:border-ring"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={row.amount}
                    onChange={(e) => updateRow(i, 'amount', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1 border border-border rounded text-sm focus:ring-1 focus:ring-ring focus:border-ring"
                  />
                </td>
                <td className="px-2 py-2">
                  {rows.length > 1 && (
                    <button
                      onClick={() => removeRow(i)}
                      className="text-foreground-muted hover:text-status-error p-1"
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length < 10 && (
        <button
          onClick={addRow}
          type="button"
          className="text-sm text-ring hover:text-ring/80 font-medium"
        >
          + Add Recipient
        </button>
      )}
    </div>
  );
}
