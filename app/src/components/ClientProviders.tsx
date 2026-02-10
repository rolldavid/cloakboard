'use client';

import dynamic from 'next/dynamic';
import { ReactNode, useMemo } from 'react';
import { getDefaultNetwork } from '@/lib/config/networks';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import { installCrsProxy } from '@/lib/aztec/crsProxy';

// Install CRS proxy before any Aztec SDK code runs — redirects
// hardcoded S3/crs.aztec.network fetches through our CORS-free API route.
installCrsProxy();

const WalletProvider = dynamic(
  () => import('@/components/wallet/WalletProvider').then((mod) => mod.WalletProvider),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingOwl />
      </div>
    ),
  }
);

interface ClientProvidersProps {
  children: ReactNode;
}

export function ClientProviders({ children }: ClientProvidersProps) {
  const network = useMemo(() => getDefaultNetwork(), []);

  return <WalletProvider network={network}>{children}</WalletProvider>;
}
