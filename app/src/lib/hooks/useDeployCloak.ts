import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/index';
import { apiUrl } from '@/lib/api';
import { getAztecClient } from '@/lib/aztec/client';

interface DeployConfig {
  name: string;
  description: string;
  duelDuration: number;
  firstDuelBlock: number;
  statements: string[];
}

interface DeployResult {
  address: string;
  txHash: string;
}

export function useDeployCloak() {
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);

  const { userAddress } = useAppStore();

  const deploy = useCallback(
    async (config: DeployConfig): Promise<string> => {
      setIsDeploying(true);
      setError(null);
      setDeployedAddress(null);
      setStartTime(Date.now());

      try {
        const res = await fetch(apiUrl('/api/deploy-cloak'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: config.name,
            duelDuration: config.duelDuration,
            firstDuelBlock: config.firstDuelBlock,
            visibility: 'open',
            keeperAddress: '', // server uses its own keeper
            accountClassId: 'duel-cloak-v1',
            tallyMode: 0,
            creatorAddress: getAztecClient()?.getAddress()?.toString() || userAddress || '',
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Deploy failed' }));
          throw new Error(data.error || `Deploy failed (${res.status})`);
        }

        const result: DeployResult = await res.json();
        setDeployedAddress(result.address);

        // Fire-and-forget background tasks
        fireAndForget(result.address, config);

        return result.address;
      } catch (err: any) {
        const msg = err?.message ?? 'Unknown deployment error';
        setError(msg);
        throw err;
      } finally {
        setIsDeploying(false);
      }
    },
    [userAddress],
  );

  const reset = useCallback(() => {
    setIsDeploying(false);
    setDeployedAddress(null);
    setError(null);
    setStartTime(null);
  }, []);

  return { deploy, isDeploying, deployedAddress, error, startTime, reset };
}

/** Non-blocking background tasks after deployment */
function fireAndForget(address: string, config: DeployConfig) {
  // Register with keeper cron
  fetch(apiUrl('/api/keeper/register-sender'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cloakAddress: address }),
  }).catch(() => {});

  // Submit initial statements from the wizard
  if (config.statements?.length) {
    for (const text of config.statements) {
      if (text.trim()) {
        fetch(apiUrl('/api/submit-statement'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cloakAddress: address, text: text.trim() }),
        }).catch(() => {});
      }
    }
  }

  // Initial duel sync (GET endpoint)
  fetch(apiUrl(`/api/duels/sync?cloakAddress=${encodeURIComponent(address)}`)).catch(() => {});
}
