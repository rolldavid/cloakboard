'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { contentFade } from '@/lib/motion';
import { useWalletContext } from '../wallet/WalletProvider';
import { useCloak } from '@/lib/hooks/useCloak';
import { useBravoCloak } from '@/lib/hooks/useBravoCloak';
import { SecurityCouncilPanel } from './SecurityCouncilPanel';
import { useAztecStore } from '@/store/aztecStore';
import { nameToSlug } from '@/lib/utils/slug';
import { MoltLanding } from '@/components/molt/MoltLanding';

interface CloakDashboardProps {
  cloakAddress: string;
  cloakMode?: number;
}

export function CloakDashboard({ cloakAddress, cloakMode = 0 }: CloakDashboardProps) {
  const { client, account, isConnected } = useWalletContext();
  const {
    connectToCloak,
    getName,
    getProposalCount,
    getPrivateVotingPower,
    isLoading,
    error,
    isConnected: isCloakConnected,
  } = useCloak(client);

  const bravo = useBravoCloak(client);

  const addCloak = useAztecStore((s: any) => s.addCloak);
  // Try to get name from store first as fallback
  const storeCloak = useAztecStore((s: any) => s.cloakList.find(
    (d: any) => d.address === cloakAddress || d.slug === cloakAddress
  ));

  const [cloakName, setCloakName] = useState<string | null>(storeCloak?.name ?? null);
  const [stats, setStats] = useState({
    proposalCount: 0,
    votingPower: 0n,
  });

  const [councilData, setCouncilData] = useState<{
    members: string[];
    threshold: number;
    emergencyThreshold: number;
  } | null>(null);

  // Only connect via CloakContractService for standard PrivateCloak (templateId 0 or undefined)
  // Molt (10) and Bravo (1) have different contract ABIs
  const isStandardCloak = !storeCloak?.templateId || storeCloak.templateId === 0;
  const isBravoCloak = storeCloak?.templateId === 1;

  // Connect standard cloaks
  useEffect(() => {
    if (!client || !isStandardCloak) return;
    const loadCloak = async () => {
      try {
        await connectToCloak(cloakAddress);
      } catch (err) {
        console.error('Failed to connect to Cloak:', err);
      }
    };
    loadCloak();
  }, [client, cloakAddress, connectToCloak, isStandardCloak]);

  // Connect Bravo cloaks via their own service
  useEffect(() => {
    if (!client || !isBravoCloak) return;
    const loadBravo = async () => {
      try {
        await bravo.connectToCloak(cloakAddress);
      } catch (err) {
        console.error('Failed to connect to Bravo Cloak:', err);
      }
    };
    loadBravo();
  }, [client, cloakAddress, isBravoCloak, bravo.connectToCloak]);

  // Read name from on-chain contract (standard cloaks)
  useEffect(() => {
    if (!isCloakConnected || !isStandardCloak) return;
    const loadName = async () => {
      try {
        const onChainName = await getName();
        if (onChainName) {
          setCloakName(onChainName);
          const slug = nameToSlug(onChainName);
          const existing = useAztecStore.getState().cloakList.find((d: any) => d.address === cloakAddress);
          if (existing) {
            if (existing.name !== onChainName || existing.slug !== slug) {
              addCloak({ ...existing, name: onChainName, slug });
            }
          }
        }
      } catch (err) {
        console.error('Failed to read Cloak name from contract:', err);
      }
    };
    loadName();
  }, [isCloakConnected, isStandardCloak, getName, cloakAddress, addCloak]);

  // Read name from on-chain contract (Bravo cloaks)
  useEffect(() => {
    if (!bravo.isConnected || !isBravoCloak) return;
    const loadName = async () => {
      try {
        const onChainName = await bravo.getName();
        if (onChainName) {
          setCloakName(onChainName);
          const slug = nameToSlug(onChainName);
          const existing = useAztecStore.getState().cloakList.find((d: any) => d.address === cloakAddress);
          if (existing) {
            if (existing.name !== onChainName || existing.slug !== slug) {
              addCloak({ ...existing, name: onChainName, slug });
            }
          }
        }
      } catch (err) {
        console.error('Failed to read Bravo Cloak name:', err);
      }
    };
    loadName();
  }, [bravo.isConnected, isBravoCloak, bravo.getName, cloakAddress, addCloak]);

  // Load stats for standard cloaks
  useEffect(() => {
    if (!isCloakConnected || !isStandardCloak) return;
    const loadStats = async () => {
      try {
        const proposals = await getProposalCount();
        let power = 0n;
        if (account) {
          power = await getPrivateVotingPower(account.address);
        }
        setStats({ proposalCount: proposals, votingPower: power });
      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    };
    loadStats();
  }, [isCloakConnected, isStandardCloak, account, getProposalCount, getPrivateVotingPower]);

  // Load stats for Bravo cloaks
  useEffect(() => {
    if (!bravo.isConnected || !isBravoCloak) return;
    const loadStats = async () => {
      try {
        const proposals = await bravo.getProposalCount();
        let power = 0n;
        if (account) {
          power = await bravo.getVotingPower(account.address);
        }
        setStats({ proposalCount: proposals, votingPower: power });
      } catch (err) {
        console.error('Failed to load Bravo stats:', err);
      }
    };
    loadStats();
  }, [bravo.isConnected, isBravoCloak, account, bravo.getProposalCount, bravo.getVotingPower]);

  if (isLoading) {
    return (
      <motion.div
        className="animate-shimmer space-y-4"
        key="skeleton"
        variants={contentFade}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <div className="h-8 bg-background-tertiary rounded-md w-1/3"></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 bg-background-tertiary rounded-md"></div>
          <div className="h-24 bg-background-tertiary rounded-md"></div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-status-error/10 border border-status-error rounded-md text-status-error">
        Failed to load Cloak: {error}
      </div>
    );
  }

  const templateLabel = storeCloak?.templateId === 1 ? 'Governor Bravo' : storeCloak?.templateId === 10 ? 'Molt' : 'PrivateCloak';
  const modeLabel = cloakMode === 0 ? 'Token-Holder' : cloakMode === 1 ? 'Multisig' : 'Hybrid';
  const slug = cloakName ? nameToSlug(cloakName) : cloakAddress;

  // Molt template gets its own landing page
  if (storeCloak?.templateId === 10) {
    return (
      <MoltLanding
        cloakName={cloakName || storeCloak?.name || ''}
        cloakAddress={cloakAddress}
      />
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={contentFade}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">
            {cloakName || 'Cloak Dashboard'}
          </h1>
          <span className="px-2 py-0.5 bg-accent/10 text-accent text-xs font-medium rounded-full">
            {templateLabel}
          </span>
          <span className="px-2 py-0.5 bg-foreground-muted/10 text-foreground-muted text-xs font-medium rounded-full">
            {modeLabel}
          </span>
        </div>
        <p className="text-sm font-mono text-foreground-muted mt-1">{cloakAddress}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-6">
          <p className="text-3xl font-bold text-accent">{stats.proposalCount}</p>
          <p className="text-sm text-foreground-muted mt-1">Total Proposals</p>
        </div>

        <div className="bg-card border border-border rounded-md p-6">
          {cloakMode === 1 && councilData ? (
            <>
              <p className="text-3xl font-bold text-accent">
                {councilData.threshold}/{councilData.members.length}
              </p>
              <p className="text-sm text-foreground-muted mt-1">Approval Threshold</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-accent">
                {isConnected ? stats.votingPower.toString() : '-'}
              </p>
              <p className="text-sm text-foreground-muted mt-1">Your Voting Power</p>
            </>
          )}
        </div>
      </div>

      {/* Security Council Panel (mode 2) */}
      {cloakMode === 2 && councilData && (
        <SecurityCouncilPanel
          councilMembers={councilData.members}
          councilThreshold={councilData.threshold}
          emergencyThreshold={councilData.emergencyThreshold}
        />
      )}

      {/* Quick Actions */}
      <div className="bg-card border border-border rounded-md p-6">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/cloak/${slug}/proposals`}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          >
            View Proposals
          </a>
          <a
            href={`/cloak/${slug}/delegation`}
            className="px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary rounded-md transition-colors"
          >
            Delegation
          </a>
          <a
            href={`/cloak/${slug}/treasury`}
            className="px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary rounded-md transition-colors"
          >
            Treasury
          </a>
          <a
            href={`/cloak/${slug}/settings`}
            className="px-4 py-2 border border-border hover:bg-card-hover text-foreground-secondary rounded-md transition-colors"
          >
            Settings
          </a>
        </div>
      </div>
    </motion.div>
  );
}
