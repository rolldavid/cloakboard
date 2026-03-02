import { useCallback, useRef } from 'react';
import { useAppStore } from '@/store/index';
import { useDeployCloak } from '@/lib/hooks/useDeployCloak';
import { DuelWizard, type DuelConfig } from '@/components/wizard/DuelWizard';
import { DeploymentExperience } from '@/components/deploy/DeploymentExperience';

export function CreateCloakPage() {
  const { isAuthenticated, userAddress } = useAppStore();
  const { deploy, isDeploying, deployedAddress, error, startTime, reset } = useDeployCloak();
  const cloakNameRef = useRef('');

  const handleSubmit = useCallback(
    async (config: DuelConfig) => {
      cloakNameRef.current = config.name;

      // Compute firstDuelBlock from date/time
      let firstDuelBlock = 0;
      if (config.firstDuelDate) {
        const dateStr = config.firstDuelDate + (config.firstDuelTime ? `T${config.firstDuelTime}` : 'T00:00');
        const target = new Date(dateStr).getTime();
        const now = Date.now();
        if (target > now) {
          firstDuelBlock = Math.ceil((target - now) / 6000); // ~6s per block
        }
      }

      await deploy({
        name: config.name,
        description: config.description,
        duelDuration: config.duelDuration,
        firstDuelBlock,
        statements: config.statements,
      });
    },
    [deploy],
  );

  // Show deployment overlay
  if (isDeploying || deployedAddress || error) {
    return (
      <DeploymentExperience
        cloakName={cloakNameRef.current}
        deployedAddress={deployedAddress}
        error={error}
        startTime={startTime}
        onRetry={reset}
      />
    );
  }

  // Wallet warning
  if (!isAuthenticated || !userAddress) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-status-warning/10 border border-status-warning/30 rounded-md p-4">
          <p className="text-sm text-foreground">
            Sign in to create a community.
          </p>
        </div>
      </div>
    );
  }

  return <DuelWizard onSubmit={handleSubmit} />;
}
