'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useBravoCloak } from '@/lib/hooks/useBravoCloak';
import { useCloakAddress } from '@/lib/hooks/useCloakAddress';
import { DelegationManager } from '@/components/templates/bravo/DelegationManager';
import { VotingPowerDisplay } from '@/components/templates/bravo/VotingPowerDisplay';
import { CloakLogo } from '@/components/ui/CloakLogo';

export default function DelegationPage() {
  const params = useParams();
  const cloakIdParam = params.id as string;

  const { client, account, isConnected } = useWalletContext();
  const bravo = useBravoCloak(client);

  // Resolve cloak address from slug/address (checks store, then registry)
  const { address: cloakAddress, isResolving, isResolved } = useCloakAddress(cloakIdParam);

  // Show loading or not found states
  const isLoadingCloak = isResolving || !isResolved;
  const cloakNotFound = isResolved && !cloakAddress;

  const [currentDelegate, setCurrentDelegate] = useState<string | undefined>();
  const [votingPower, setVotingPower] = useState(0n);
  const [rawBalance, setRawBalance] = useState(0n);
  const [delegatedToYou, setDelegatedToYou] = useState(0n);
  const [totalSupply, setTotalSupply] = useState(0n);

  // Use refs for callback functions to avoid infinite loops in useEffect
  // (callback functions recreate on every render, causing dependency changes)
  const connectToCloakRef = useRef(bravo.connectToCloak);
  connectToCloakRef.current = bravo.connectToCloak;

  const getDelegationInfoRef = useRef(bravo.getDelegationInfo);
  getDelegationInfoRef.current = bravo.getDelegationInfo;

  const getTotalVotingPowerRef = useRef(bravo.getTotalVotingPower);
  getTotalVotingPowerRef.current = bravo.getTotalVotingPower;

  // Connect to cloak - only depends on stable values, not function refs
  useEffect(() => {
    if (client && bravo.isServiceReady && cloakAddress) {
      connectToCloakRef.current(cloakAddress);
    }
  }, [client, cloakAddress, bravo.isServiceReady]);  // No function in deps!

  // Load delegation info - only depends on stable values
  useEffect(() => {
    if (!bravo.isConnected || !account) return;

    const loadDelegationInfo = async () => {
      try {
        const [delInfo, supply] = await Promise.all([
          getDelegationInfoRef.current(account.address),
          getTotalVotingPowerRef.current(),
        ]);

        const zeroAddr = '0x0000000000000000000000000000000000000000000000000000000000000000';
        setCurrentDelegate(delInfo.delegate === zeroAddr ? undefined : delInfo.delegate);
        setVotingPower(delInfo.totalVotes);
        setDelegatedToYou(delInfo.delegatedPower);
        // Own balance = total votes minus what others delegated to you
        setRawBalance(delInfo.totalVotes - delInfo.delegatedPower);
        setTotalSupply(supply);
      } catch (err) {
        console.error('Failed to load delegation info:', err);
      }
    };
    loadDelegationInfo();
  }, [bravo.isConnected, account?.address]);  // Only stable values!

  const isSelfDelegated = account && currentDelegate === account.address;

  const handleDelegate = async (toAddress: string) => {
    await bravo.delegate(toAddress);
    setCurrentDelegate(toAddress);
    if (account) {
      const info = await bravo.getDelegationInfo(account.address);
      setVotingPower(info.totalVotes);
      setDelegatedToYou(info.delegatedPower);
      setRawBalance(info.totalVotes - info.delegatedPower);
    }
  };

  const handleSelfDelegate = async () => {
    if (!account) return;
    // Self-delegate = delegate to your own address (OZ ERC20Votes pattern)
    await bravo.selfDelegate(account.address);
    setCurrentDelegate(account.address);
    const info = await bravo.getDelegationInfo(account.address);
    setVotingPower(info.totalVotes);
    setDelegatedToYou(info.delegatedPower);
    setRawBalance(info.totalVotes - info.delegatedPower);
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
            <Link href={`/cloak/${cloakIdParam}`} className="text-accent hover:text-accent text-sm">
              &larr; Back to Dashboard
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-8">Delegation</h1>

          {bravo.error && (
            <div className="mb-6 p-4 bg-status-error/10 border border-status-error rounded-md text-status-error">
              {bravo.error}
            </div>
          )}

          {isLoadingCloak ? (
            <div className="text-center py-12 bg-background-secondary rounded-md">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-foreground-muted">Looking for "{cloakIdParam}"...</p>
            </div>
          ) : cloakNotFound ? (
            <div className="text-center py-12 bg-background-secondary rounded-md">
              <p className="text-foreground-muted mb-4">Cloak not found.</p>
              <p className="text-foreground-muted text-sm">
                The cloak "{cloakIdParam}" was not found. It may not exist or hasn't been loaded yet.
              </p>
              <Link href="/explore" className="text-accent hover:underline mt-4 inline-block">
                Browse Cloaks
              </Link>
            </div>
          ) : !isConnected ? (
            <div className="text-center py-12 bg-background-secondary rounded-md">
              <p className="text-foreground-muted">Connect your wallet to manage delegation.</p>
            </div>
          ) : !bravo.isServiceReady || !bravo.isConnected ? (
            <div className="text-center py-12 bg-background-secondary rounded-md">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-foreground-muted">Loading delegation service...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <VotingPowerDisplay
                  votingPower={votingPower}
                  totalSupply={totalSupply || 1n}
                  delegatedToYou={delegatedToYou}
                  yourBalance={rawBalance}
                  decimals={0}
                  tokenSymbol="VP"
                />
              </div>
              <div className="lg:col-span-2">
                <DelegationManager
                  currentDelegation={currentDelegate}
                  selfDelegated={!!isSelfDelegated}
                  yourVotingPower={votingPower}
                  yourRawBalance={rawBalance}
                  decimals={0}
                  tokenSymbol="VP"
                  topDelegates={[]}
                  onDelegate={handleDelegate}
                  onSelfDelegate={handleSelfDelegate}
                  isLoading={bravo.isLoading}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
