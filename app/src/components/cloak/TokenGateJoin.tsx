'use client';

import React, { useState } from 'react';
import { EthConnectButton } from '@/components/wallet/EthConnectButton';

interface TokenGateJoinProps {
  membershipMode: 'aztec-token' | 'erc20-token';
  tokenAddress?: string;
  minimumBalance?: string;
  /** If the user authenticated via Ethereum, their ETH address is available */
  linkedEthAddress?: string;
  onJoinAztecToken: () => Promise<void>;
  onJoinERC20: (verifiedBalance: bigint, nullifier: string) => Promise<void>;
}

export function TokenGateJoin({
  membershipMode,
  tokenAddress,
  minimumBalance,
  linkedEthAddress,
  onJoinAztecToken,
  onJoinERC20,
}: TokenGateJoinProps) {
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofGenerated, setProofGenerated] = useState(false);

  const handleAztecJoin = async () => {
    setIsJoining(true);
    setError(null);
    try {
      await onJoinAztecToken();
    } catch (err: any) {
      setError(err.message || 'Failed to join');
    } finally {
      setIsJoining(false);
    }
  };

  const handleERC20Join = async () => {
    setIsJoining(true);
    setError(null);
    try {
      // In production: generate ZK proof, then call onJoinERC20
      // For now, placeholder flow
      setProofGenerated(true);
      // The actual proof generation would happen via ERC20ProofService
      // await onJoinERC20(verifiedBalance, nullifier);
    } catch (err: any) {
      setError(err.message || 'Failed to generate proof');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-background-secondary rounded-md">
        <h3 className="font-medium text-foreground mb-2">
          {membershipMode === 'aztec-token' ? 'Token-Gated Cloak' : 'ERC20 Token-Gated Cloak'}
        </h3>
        <p className="text-sm text-foreground-muted">
          {membershipMode === 'aztec-token'
            ? `Hold at least ${minimumBalance ?? '1'} tokens at ${tokenAddress?.slice(0, 10)}... to join.`
            : `Prove your ERC20 token balance (min: ${minimumBalance ?? '1'}) via ZK proof to join.`}
        </p>
      </div>

      {membershipMode === 'aztec-token' && (
        <button
          onClick={handleAztecJoin}
          disabled={isJoining}
          className="w-full px-4 py-3 bg-ring text-white rounded-md font-medium hover:bg-ring/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isJoining ? 'Proving token balance...' : 'Join with Aztec Token'}
        </button>
      )}

      {membershipMode === 'erc20-token' && (
        <div className="space-y-3">
          {linkedEthAddress ? (
            <div className="flex items-center gap-3 p-2 bg-background-secondary rounded-md">
              <span className="text-sm text-foreground-secondary">Wallet:</span>
              <span className="font-mono text-sm text-foreground">{linkedEthAddress.slice(0, 6)}...{linkedEthAddress.slice(-4)}</span>
              <span className="text-xs text-status-success">Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground-secondary">Step 1:</span>
              <EthConnectButton compact />
            </div>
          )}

          <button
            onClick={handleERC20Join}
            disabled={isJoining}
            className="w-full px-4 py-3 bg-ring text-white rounded-md font-medium hover:bg-ring/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isJoining
              ? 'Generating ZK proof...'
              : proofGenerated
              ? 'Submit Proof & Join'
              : 'Generate Balance Proof & Join'}
          </button>

          <p className="text-xs text-foreground-muted text-center">
            Your wallet address and exact balance are never revealed on-chain.
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-status-error/10 border border-status-error/20 rounded-md">
          <p className="text-sm text-status-error">{error}</p>
        </div>
      )}
    </div>
  );
}
