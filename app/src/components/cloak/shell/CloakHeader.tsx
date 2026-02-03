'use client';

import React, { useEffect, useState } from 'react';
import { useCloakContext } from './CloakContext';
import { getTemplateMetadata } from '@/lib/constants/templates';
import { TemplateIcon } from '@/components/ui/TemplateIcon';
import { useWalletContext } from '@/components/wallet/WalletProvider';

export function CloakHeader() {
  const { name, templateId, address, isLoading } = useCloakContext();
  const { client } = useWalletContext();
  const [agentCount, setAgentCount] = useState<number | null>(null);

  // Fetch agent count for Molt cloaks (templateId 10)
  useEffect(() => {
    if (templateId !== 10 || !address || !client) return;
    let cancelled = false;

    (async () => {
      try {
        const { MoltCloakService } = await import('@/lib/templates/MoltCloakService');
        const { AztecAddress } = await import('@aztec/aztec.js/addresses');
        const wallet = client.getWallet();
        if (!wallet) return;
        const senderAddress = client.getAddress?.();
        const service = new MoltCloakService(wallet, senderAddress ?? undefined);
        const artifact = (await import('@/lib/aztec/artifacts/MoltCloak.json')).default;
        await service.connect(AztecAddress.fromString(address), artifact);
        const count = await service.getAgentCount();
        if (!cancelled) setAgentCount(count);
      } catch {
        // Agent count is non-critical — silently ignore
      }
    })();

    return () => { cancelled = true; };
  }, [templateId, address, client]);

  const template = getTemplateMetadata(templateId);

  if (isLoading) {
    return (
      <div className="bg-card border-b border-border px-6 py-4 animate-shimmer">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-background-tertiary rounded-lg" />
          <div>
            <div className="h-6 w-48 bg-background-tertiary rounded-md mb-2" />
            <div className="h-4 w-32 bg-background-tertiary rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  const colorClasses: Record<string, { bg: string; text: string }> = {
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
    slate: { bg: 'bg-slate-500/10', text: 'text-slate-400' },
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
    violet: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
    teal: { bg: 'bg-teal-500/10', text: 'text-teal-400' },
  };

  return (
    <div className="bg-card border-b border-border">
      <div className="px-6 py-4">
        <div className="flex items-center">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                colorClasses[template.color]?.bg || 'bg-background-tertiary'
              }`}
            >
              <TemplateIcon name={template.icon} size="lg" className={colorClasses[template.color]?.text || 'text-foreground-muted'} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-foreground">{name}</h1>
                {templateId === 10 && agentCount !== null && (
                  <span className="text-sm text-foreground-muted font-medium">
                    {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
