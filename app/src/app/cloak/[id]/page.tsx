'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import { useCloakAddress } from '@/lib/hooks/useCloakAddress';
import { ClosedCloakAccessScreen } from '@/components/cloak/ClosedCloakAccessScreen';

// Dynamically import to avoid SSR issues
const CloakDashboard = dynamic(
  () => import('@/components/cloak/CloakDashboard').then((m) => m.CloakDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="animate-shimmer space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-background-tertiary rounded-md" />
          ))}
        </div>
        <div className="h-64 bg-background-tertiary rounded-md" />
      </div>
    ),
  }
);

export default function CloakPage() {
  const params = useParams();
  const router = useRouter();
  const cloakId = params.id as string;
  const { isAuthenticated } = useAuth();
  const { client, account } = useWalletContext();

  // Navigate to onboarding to connect a wallet
  const handleConnectWallet = useCallback(() => {
    router.push('/onboarding');
  }, [router]);

  // Resolve cloak address from slug/address (checks store, then registry)
  const { address: cloakAddress, cloak, isResolving, isResolved, error: resolveError } = useCloakAddress(cloakId);
  const cloakMode = cloak?.cloakMode;

  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);

  // Check membership for closed cloaks
  useEffect(() => {
    async function checkMembership() {
      // Only check for closed cloaks when user is authenticated
      if (!cloak || cloak.isPubliclyViewable !== false || !isAuthenticated || !client || !account?.address) {
        setIsMember(null);
        return;
      }

      setIsCheckingMembership(true);
      try {
        // Dynamically import the service to avoid SSR issues
        const [{ GovernorBravoCloakService }, { AztecAddress }, { getGovernorBravoCloakArtifact }] = await Promise.all([
          import('@/lib/templates/GovernorBravoCloakService'),
          import('@aztec/aztec.js/addresses'),
          import('@/lib/aztec/contracts'),
        ]);

        const wallet = client.getWallet();
        const userAddress = AztecAddress.fromString(account.address);
        const cloakAddress = AztecAddress.fromString(cloak.address);
        const paymentMethod = client.getPaymentMethod?.();

        const service = new GovernorBravoCloakService(wallet, userAddress, paymentMethod);
        const artifact = await getGovernorBravoCloakArtifact();
        await service.connect(cloakAddress, artifact);

        // Check if user has voting power (is a member)
        const votingPower = await service.getVotes(userAddress);
        setIsMember(votingPower > 0n);
      } catch (err) {
        console.error('[CloakPage] Failed to check membership:', err);
        // If we can't check, assume not a member for closed cloaks
        setIsMember(false);
      } finally {
        setIsCheckingMembership(false);
      }
    }

    checkMembership();
  }, [cloak, isAuthenticated, client, account?.address]);

  // Show loading while resolving
  if (isResolving || !isResolved) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="w-16 h-16 border-4 border-template-emerald border-t-transparent rounded-full animate-spin mb-6" />
        <h2 className="text-xl font-semibold text-foreground mb-2">Loading Cloak</h2>
        <p className="text-foreground-secondary text-center max-w-md">
          Resolving "{cloakId}"...
        </p>
      </div>
    );
  }

  // Show not found error if resolution failed
  if (!cloakAddress) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
        <div className="w-20 h-20 rounded-full bg-status-error/10 flex items-center justify-center mb-6">
          <svg
            className="w-10 h-10 text-status-error"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">Cloak Not Found</h2>
        <p className="text-foreground-secondary text-center max-w-md mb-6">
          The cloak "{cloakId}" could not be found. It may not exist or hasn't been loaded yet.
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

  // For closed cloaks, show access screen if not a member
  if (cloak && cloak.isPubliclyViewable === false) {
    // Not authenticated - show connect prompt
    if (!isAuthenticated) {
      return (
        <ClosedCloakAccessScreen
          cloakName={cloak.name}
          onConnectWallet={handleConnectWallet}
          isCheckingMembership={false}
        />
      );
    }

    // Checking membership
    if (isCheckingMembership || isMember === null) {
      return (
        <ClosedCloakAccessScreen
          cloakName={cloak.name}
          isCheckingMembership={true}
        />
      );
    }

    // Not a member
    if (!isMember) {
      return (
        <ClosedCloakAccessScreen
          cloakName={cloak.name}
          onConnectWallet={handleConnectWallet}
          isMember={false}
        />
      );
    }
  }

  return <CloakDashboard cloakAddress={cloakAddress} cloakMode={cloakMode} />;
}
