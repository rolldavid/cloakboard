'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useCloak } from '@/lib/hooks/useCloak';
import { useCloakAddress } from '@/lib/hooks/useCloakAddress';
import { ProposalCard } from '@/components/governance/ProposalCard';
import { ProposalForm } from '@/components/governance/ProposalForm';
import Link from 'next/link';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function ProposalsPage() {
  const params = useParams();
  const cloakId = params.id as string;
  const { client, isConnected } = useWalletContext();
  const { address: cloakAddress, isResolving, isResolved } = useCloakAddress(cloakId);
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
      if (client && cloakAddress) {
        await connectToCloak(cloakAddress);
      }
    };
    loadCloak();
  }, [client, cloakAddress, connectToCloak]);

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

  if (isResolving || !isResolved) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="w-16 h-16 border-4 border-template-emerald border-t-transparent rounded-full animate-spin mb-6" />
        <p className="text-foreground-secondary">Resolving cloak...</p>
      </div>
    );
  }

  if (!cloakAddress) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <h2 className="text-2xl font-semibold text-foreground mb-2">Cloak Not Found</h2>
        <p className="text-foreground-secondary text-center max-w-md mb-6">
          The cloak "{cloakId}" could not be found.
        </p>
        <Link
          href="/explore"
          className="px-6 py-3 bg-template-emerald text-white font-medium rounded-lg hover:bg-template-emerald/90 transition-colors"
        >
          Browse Cloaks
        </Link>
      </div>
    );
  }

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
