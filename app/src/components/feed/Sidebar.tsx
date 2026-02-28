import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/index';
import { fetchRecentCloaks, fetchJoinedCloaks } from '@/lib/api/feedClient';
import type { CloakSummary } from '@/lib/api/feedClient';
import { getAztecClient } from '@/lib/aztec/client';
import { getUserProfileArtifact } from '@/lib/aztec/contracts';
import { UserProfileService } from '@/lib/aztec/UserProfileService';
import { AztecAddress } from '@aztec/aztec.js/addresses';

// Whisper level thresholds (on-chain vote points only)
const LEVELS = [
  { level: 1, name: 'Whisper', minPoints: 0 },
  { level: 2, name: 'Murmur', minPoints: 50 },
  { level: 3, name: 'Voice', minPoints: 200 },
  { level: 4, name: 'Echo', minPoints: 500 },
  { level: 5, name: 'Resonance', minPoints: 1000 },
  { level: 6, name: 'Thunder', minPoints: 2500 },
];

function getLevel(points: number) {
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (points >= lvl.minPoints) current = lvl;
  }
  const idx = LEVELS.indexOf(current);
  const next = idx < LEVELS.length - 1 ? LEVELS[idx + 1] : null;
  return { ...current, next };
}

export function Sidebar() {
  const { isAuthenticated, userAddress } = useAppStore();
  const [recentCloaks, setRecentCloaks] = useState<CloakSummary[]>([]);
  const [joinedCloaks, setJoinedCloaks] = useState<CloakSummary[]>([]);
  const [onChainPoints, setOnChainPoints] = useState<number | null>(null);

  useEffect(() => {
    fetchRecentCloaks(10).then(setRecentCloaks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userAddress) return;
    fetchJoinedCloaks(userAddress).then(setJoinedCloaks).catch(() => {});
  }, [isAuthenticated, userAddress]);

  // Read on-chain private whisper points from UserProfile when wallet is ready.
  // Retries up to 10 times with 2s delay if wallet isn't ready yet (async creation).
  useEffect(() => {
    if (!isAuthenticated || !userAddress) return;

    let cancelled = false;

    (async () => {
      const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
      if (!profileAddress) return;

      // Wait for wallet to become available (async creation after auth)
      let client = getAztecClient();
      for (let attempt = 0; attempt < 10 && !cancelled; attempt++) {
        client = getAztecClient();
        if (client?.hasWallet()) break;
        await new Promise(r => setTimeout(r, 2000));
      }
      if (cancelled || !client?.hasWallet()) {
        // Wallet never became ready — show default level
        setOnChainPoints(0);
        return;
      }

      try {
        const wallet = client.getWallet();
        const senderAddress = client.getAddress() ?? undefined;
        const paymentMethod = client.getPaymentMethod();
        const artifact = await getUserProfileArtifact();
        const addr = AztecAddress.fromString(profileAddress);
        const node = client.getNode();

        // Register contract if needed
        if (node) {
          try {
            const instance = await node.getContract(addr);
            if (instance) await wallet.registerContract(instance, artifact);
          } catch { /* may already be registered */ }
        }

        const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
        await svc.connect(addr, artifact);
        console.log('[Sidebar] Reading on-chain points for', senderAddress?.toString()?.slice(0, 14));
        const points = await svc.getMyPoints();
        console.log('[Sidebar] On-chain points:', points);
        if (!cancelled) setOnChainPoints(points);
      } catch (err: any) {
        console.error('[Sidebar] Failed to read on-chain points:', err?.message, err?.stack?.slice(0, 200));
        // Show default level even on error
        if (!cancelled) setOnChainPoints(0);
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, userAddress]);

  const level = onChainPoints !== null ? getLevel(onChainPoints) : null;

  return (
    <div className="hidden lg:block w-72 shrink-0 space-y-4">
      {/* Your Cloaks */}
      {isAuthenticated && (
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Your Cloaks</h3>
          {joinedCloaks.length > 0 ? (
            <ul className="space-y-1.5">
              {joinedCloaks.map((c) => (
                <li key={c.address}>
                  <Link
                    to={`/c/${c.slug || c.address}`}
                    className="text-sm text-accent hover:underline"
                  >
                    c/{c.name || c.slug || c.address.slice(0, 10)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-foreground-muted">
              Join communities from{' '}
              <Link to="/explore" className="text-accent hover:underline">Explore</Link>
            </p>
          )}
        </div>
      )}

      {/* Recent Communities */}
      {recentCloaks.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Recent Communities</h3>
          <ul className="space-y-1.5">
            {recentCloaks.map((c) => (
              <li key={c.address}>
                <Link
                  to={`/c/${c.slug || c.address}`}
                  className="text-sm text-accent hover:underline"
                >
                  c/{c.name || c.slug || c.address.slice(0, 10)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Whisper Level — on-chain private points */}
      {isAuthenticated && level && onChainPoints !== null && (
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2">Whisper Level</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 bg-accent/10 text-accent text-xs font-medium rounded-full">
              Lv.{level.level}
            </span>
            <span className="text-sm font-medium text-foreground">{level.name}</span>
          </div>
          <p className="text-xs text-foreground-muted mb-1">
            {onChainPoints.toLocaleString()} points
          </p>
          <p className="text-xs text-foreground-muted/60 mb-2">
            Private on-chain — only you can see this
          </p>
          {level.next && (
            <div>
              <div className="flex justify-between text-xs text-foreground-muted mb-1">
                <span>Next: {level.next.name}</span>
                <span>{level.next.minPoints - onChainPoints} pts to go</span>
              </div>
              <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-accent rounded-full"
                  initial={{ width: '0%' }}
                  animate={{
                    width: `${Math.min(
                      ((onChainPoints - level.minPoints) /
                        (level.next.minPoints - level.minPoints)) * 100,
                      100,
                    )}%`,
                  }}
                  transition={{ type: 'spring', stiffness: 100, damping: 20 }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
