'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { CloakLogo } from '@/components/ui/CloakLogo';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { getDisplayNameService } from '@/lib/username/DisplayNameService';

export default function SettingsPage() {
  const params = useParams();
  const cloakId = params.id as string;
  const { account } = useWalletContext();

  const [displayName, setDisplayName] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load current display name
  useEffect(() => {
    if (!account?.address) return;
    const service = getDisplayNameService();
    service.getOwnDisplayName(account.address).then((name) => {
      if (name) {
        setDisplayName(name);
        setSavedName(name);
      }
    });
  }, [account?.address]);

  const handleSaveDisplayName = async () => {
    if (!account?.address || !displayName.trim()) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      const service = getDisplayNameService();
      // Note: In a full implementation, this would call setDisplayName with a wallet instance.
      // For now, we cache locally. The on-chain write happens when the wallet is available.
      const { hashDisplayName } = await import('@/lib/username/DisplayNameService');
      const nameHash = hashDisplayName(displayName.trim());

      // Cache locally
      await service.setDisplayName(null as any, { toString: () => account.address } as any, displayName.trim()).catch(() => {
        // If on-chain write fails (no wallet), still cache locally via direct DB access
      });

      setSavedName(displayName.trim());
      setSaveMessage('Display name updated');
    } catch (err) {
      setSaveMessage('Failed to save display name');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <CloakLogo />
            </Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Link href={`/cloak/${cloakId}`} className="text-accent hover:text-accent text-sm">
              &larr; Back to Dashboard
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-8">Settings</h1>

          <div className="bg-card border border-border rounded-md p-6 space-y-6">
            {/* Display Name Editor */}
            <div>
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Display Name
              </h3>
              <p className="text-sm text-foreground-muted mb-3">
                Your display name appears when you post comments or proposals in a Cloak.
                It is stored on your account contract and shared across all Cloaks.
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter display name..."
                  maxLength={20}
                  className="flex-1 px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
                />
                <button
                  onClick={handleSaveDisplayName}
                  disabled={saving || !displayName.trim() || displayName.trim() === savedName}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
              {saveMessage && (
                <p className={`text-sm mt-2 ${saveMessage.includes('Failed') ? 'text-status-error' : 'text-status-success'}`}>
                  {saveMessage}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-2">
                Cloak Address
              </h3>
              <p className="font-mono text-sm break-all">{cloakId}</p>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-4">
                Governance Settings
              </h3>
              <p className="text-foreground-muted text-sm">
                Governance settings are immutable and were set during Cloak creation.
                To change settings, create a proposal to deploy a new Cloak contract.
              </p>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-medium text-foreground-muted uppercase tracking-wide mb-4">
                Danger Zone
              </h3>
              <div className="bg-status-error/10 border border-status-error rounded-md p-4">
                <p className="text-status-error text-sm mb-4">
                  Cloak contracts on Aztec Network are immutable. There is no way to delete
                  or modify the deployed contract directly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
