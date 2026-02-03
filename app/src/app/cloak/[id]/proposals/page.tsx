'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useCloakContext } from '@/components/cloak/shell/CloakContext';
import { useMoltCloak } from '@/lib/hooks/useMoltCloak';
import { MoltProposalCard } from '@/components/molt/MoltProposalCard';
import { MoltProposalForm } from '@/components/molt/MoltProposalForm';

// Fallback: generic proposals page for non-Molt templates
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useCloak } from '@/lib/hooks/useCloak';
import { ProposalCard } from '@/components/governance/ProposalCard';
import { ProposalForm } from '@/components/governance/ProposalForm';
import Link from 'next/link';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function ProposalsPage() {
  const params = useParams();
  const cloakId = params.id as string;
  const { templateId } = useCloakContext();

  if (templateId === 10) {
    return <MoltProposalsContent cloakId={cloakId} />;
  }

  return <GenericProposalsContent cloakId={cloakId} />;
}

// ===== MOLT PROPOSALS =====

interface MoltProposalData {
  id: number;
  contentHash: string;
  content: string | null;
  author: string;
  votesFor: number;
  votesAgainst: number;
  status: 'active' | 'passed' | 'rejected' | 'executed';
  endBlock: number;
  snapshotBlock: number;
  type: 'general' | 'toggle_discussion' | 'update_rate_limits' | 'update_viewing_hours';
  proposedHours?: number;
}

function MoltProposalsContent({ cloakId }: { cloakId: string }) {
  const {
    isConnecting,
    isConnected,
    isMember,
    error,
  } = useMoltCloak(cloakId);

  const [proposals, setProposals] = useState<MoltProposalData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadProposals = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/proposals`);
      if (!res.ok) throw new Error('Failed to load proposals');
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch (err) {
      console.error('[MoltProposals] Load failed:', err);
    }
    setIsLoading(false);
  }, [cloakId]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const handleCreate = async (proposal: { content: string; proposalType: number; proposedHours?: number }) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create proposal');
      }
      setShowCreateForm(false);
      await loadProposals();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create proposal');
    }
    setActionLoading(false);
  };

  const handleVote = async (proposalId: number, support: boolean) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/proposals/${proposalId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ support }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to vote');
      }
      await loadProposals();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to vote');
    }
    setActionLoading(false);
  };

  const handleExecute = async (proposalId: number) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/molt/${cloakId}/proposals/${proposalId}/execute`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to execute');
      }
      await loadProposals();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to execute proposal');
    }
    setActionLoading(false);
  };

  if (isConnecting) {
    return (
      <div className="p-6 space-y-4 animate-shimmer">
        <div className="h-8 bg-background-tertiary rounded-md w-1/4" />
        <div className="h-32 bg-background-tertiary rounded-md" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-foreground-muted">
            {proposals.length} {proposals.length === 1 ? 'proposal' : 'proposals'}
          </p>
        </div>
        {isMember && (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-md transition-colors"
          >
            New Proposal
          </button>
        )}
      </div>

      {(error || actionError) && (
        <div className="mb-4 p-3 bg-status-error/10 border border-status-error rounded-md text-status-error text-sm">
          {actionError || error}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-6">
          <MoltProposalForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateForm(false)}
            isLoading={actionLoading}
          />
        </div>
      )}

      {/* Proposals */}
      {isLoading ? (
        <div className="space-y-4 animate-shimmer">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-background-tertiary rounded-md" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-16 bg-background-secondary rounded-md">
          <svg className="w-12 h-12 mx-auto text-foreground-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-foreground-muted">No proposals yet.</p>
          {isMember && (
            <p className="text-sm text-foreground-muted mt-1">Create the first governance proposal.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <MoltProposalCard
              key={proposal.id}
              proposal={proposal}
              isMember={isMember}
              onVote={handleVote}
              onExecute={handleExecute}
              isLoading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== GENERIC PROPOSALS (non-Molt templates) =====

function GenericProposalsContent({ cloakId }: { cloakId: string }) {
  const { client, isConnected } = useWalletContext();
  const {
    connectToCloak,
    createProposal,
    castVote,
    executeProposal,
    getProposalCount,
    getProposal,
    getVoteTally,
    isLoading,
    error,
    isConnected: isCloakConnected,
  } = useCloak(client);

  const [proposals, setProposals] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    const loadCloak = async () => {
      if (client) {
        await connectToCloak(cloakId);
      }
    };
    loadCloak();
  }, [client, cloakId, connectToCloak]);

  useEffect(() => {
    const loadProposals = async () => {
      if (!isCloakConnected) return;

      try {
        const count = await getProposalCount();
        const loadedProposals = [];

        for (let i = 0; i < count; i++) {
          const proposal = await getProposal(BigInt(i));
          const tally = await getVoteTally(BigInt(i));
          loadedProposals.push({ ...proposal, ...tally });
        }

        setProposals(loadedProposals);
      } catch (err) {
        console.error('Failed to load proposals:', err);
      }
    };

    loadProposals();
  }, [isCloakConnected, getProposalCount, getProposal, getVoteTally]);

  const handleCreateProposal = async (proposal: any) => {
    await createProposal(
      proposal.title,
      proposal.description,
      proposal.proposalType,
      proposal.targetAddress,
      proposal.value
    );
    setShowCreateForm(false);
    const count = await getProposalCount();
    const newProposal = await getProposal(BigInt(count - 1));
    const tally = await getVoteTally(BigInt(count - 1));
    setProposals([...proposals, { ...newProposal, ...tally }]);
  };

  return (
    <div className="min-h-screen">
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

      <main className="py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <Link href={`/cloak/${cloakId}`} className="text-accent hover:text-accent text-sm">
              &larr; Back to Dashboard
            </Link>
          </div>

          <div className="flex justify-between items-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">Proposals</h1>
            {isConnected && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
              >
                Create Proposal
              </button>
            )}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-status-error/10 border border-status-error rounded-md text-status-error">
              {error}
            </div>
          )}

          {showCreateForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-card rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-semibold mb-4">Create New Proposal</h2>
                <ProposalForm
                  onSubmit={handleCreateProposal}
                  isLoading={isLoading}
                  onCancel={() => setShowCreateForm(false)}
                />
              </div>
            </div>
          )}

          <div className="space-y-6">
            {proposals.length === 0 ? (
              <div className="text-center py-12 bg-background-secondary rounded-md">
                <p className="text-foreground-muted">No proposals yet.</p>
                {isConnected && (
                  <p className="text-sm text-foreground-muted mt-2">
                    Create the first proposal to start governance.
                  </p>
                )}
              </div>
            ) : (
              proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  id={proposal.id}
                  title={proposal.title}
                  description={proposal.description}
                  proposalType={proposal.proposalType}
                  creator={proposal.creator}
                  startBlock={proposal.startBlock}
                  endBlock={proposal.endBlock}
                  executed={proposal.executed}
                  yesVotes={proposal.forVotes || proposal.yesVotes || 0n}
                  noVotes={proposal.againstVotes || proposal.noVotes || 0n}
                  abstainVotes={proposal.abstainVotes || 0n}
                  totalVotes={proposal.totalVotes || 0n}
                  onVote={castVote}
                  onExecute={executeProposal}
                  isLoading={isLoading}
                />
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
