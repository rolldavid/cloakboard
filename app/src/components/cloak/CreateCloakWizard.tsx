'use client';

import React, { useState, useEffect } from 'react';
import { useWalletContext } from '../wallet/WalletProvider';
import { useAuth } from '@/lib/hooks/useAuth';
import { LoadingOwl } from '@/components/ui/LoadingOwl';
import { useCloak } from '@/lib/hooks/useCloak';
import { getCloakDeploymentRateLimitStatus } from '@/lib/rateLimit/cloakDeploymentRateLimiter';
import { useAztecStore } from '@/store/aztecStore';

interface CloakConfig {
  name: string;
  votingDuration: number;
  quorumThreshold: number;
}

const STEPS = ['Basics', 'Governance', 'Review'];

export function CreateCloakWizard() {
  const { client, account, isConnected: walletConnected, isClientReady, error: walletError } = useWalletContext();
  const { isAuthenticated, username, address: authAddress } = useAuth();
  const { deployCloak, isLoading, error, isModulesLoaded } = useCloak(client);
  const addCloak = useAztecStore((s: any) => s.addCloak);

  // User is connected if either wallet or auth system says so
  const isConnected = walletConnected || isAuthenticated;
  // Use auth address if available, otherwise use wallet account address
  const userAddress = authAddress || account?.address;

  const [currentStep, setCurrentStep] = useState(0);
  const [config, setConfig] = useState<CloakConfig>({
    name: '',
    votingDuration: 100, // blocks
    quorumThreshold: 2,
  });
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [rateLimitStatus, setRateLimitStatus] = useState<{
    remainingDeployments: number;
    nextResetTime: Date | null;
  } | null>(null);

  // Load rate limit status on mount and after deployment
  useEffect(() => {
    const status = getCloakDeploymentRateLimitStatus();
    setRateLimitStatus({
      remainingDeployments: status.remainingDeployments,
      nextResetTime: status.nextResetTime,
    });
  }, [deployedAddress]);

  const handleDeploy = async () => {
    if (!client) {
      console.error('Client not available');
      return;
    }

    if (!userAddress) {
      console.error('User address not available. authAddress:', authAddress, 'account:', account);
      return;
    }

    // userAddress is guaranteed to be a string after the check above
    const adminAddressStr = String(userAddress);

    try {
      const address = await deployCloak(
        config.name,
        adminAddressStr,
        config.votingDuration,
        config.quorumThreshold
      );
      if (address) {
        addCloak({
          address,
          name: config.name,
          memberCount: 1,
          proposalCount: 0,
        });
      }
      setDeployedAddress(address || null);
    } catch (err) {
      console.error('Failed to deploy Cloak:', err);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-6 bg-status-warning/10 border border-status-warning rounded-md text-center">
        <p className="text-status-warning">Please sign in to create a Cloak.</p>
      </div>
    );
  }

  if (!isClientReady || !isModulesLoaded) {
    return (
      <div className="p-6 bg-status-info/10 border border-status-info rounded-md text-center">
        <LoadingOwl />
        <p className="text-status-info">Connecting to Aztec network...</p>
        {walletError && (
          <p className="text-status-error mt-2 text-sm">{walletError}</p>
        )}
      </div>
    );
  }

  if (deployedAddress) {
    return (
      <div className="p-6 bg-status-success/10 border border-status-success rounded-md text-center">
        <h3 className="text-lg font-semibold text-status-success mb-2">Cloak Created!</h3>
        <p className="text-status-success mb-4">Your Cloak has been deployed successfully.</p>
        <div className="bg-card p-3 rounded-md border border-status-success mb-4">
          <label className="text-xs text-foreground-muted uppercase tracking-wide">Contract Address</label>
          <p className="font-mono text-sm break-all">{deployedAddress}</p>
        </div>
        {rateLimitStatus && rateLimitStatus.remainingDeployments < 5 && (
          <p className="text-sm text-foreground-muted">
            {rateLimitStatus.remainingDeployments} Cloak deployment{rateLimitStatus.remainingDeployments === 1 ? '' : 's'} remaining this hour.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Steps */}
      <div className="flex justify-between mb-8">
        {STEPS.map((step, index) => (
          <div
            key={step}
            className={`flex items-center ${index < STEPS.length - 1 ? 'flex-1' : ''}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                index <= currentStep
                  ? 'bg-accent text-white'
                  : 'bg-background-tertiary text-foreground-muted'
              }`}
            >
              {index + 1}
            </div>
            <span
              className={`ml-2 text-sm ${
                index <= currentStep ? 'text-accent font-medium' : 'text-foreground-muted'
              }`}
            >
              {step}
            </span>
            {index < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-4 ${
                  index < currentStep ? 'bg-accent' : 'bg-background-tertiary'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-status-error/10 border border-status-error rounded-md text-status-error">
          {error}
        </div>
      )}

      {/* Step Content */}
      <div className="bg-card border border-border rounded-md p-6">
        {currentStep === 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Basic Information</h2>
            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Cloak Name
              </label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                maxLength={31}
                placeholder="My Cloak"
                className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="mt-1 text-xs text-foreground-muted">
                Max 31 characters
              </p>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Governance Settings</h2>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Voting Duration (blocks)
              </label>
              <input
                type="number"
                value={config.votingDuration}
                onChange={(e) => setConfig({ ...config, votingDuration: parseInt(e.target.value) || 0 })}
                min={1}
                className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="mt-1 text-xs text-foreground-muted">
                How many blocks a proposal stays open for voting
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground-secondary mb-1">
                Quorum Threshold
              </label>
              <input
                type="number"
                value={config.quorumThreshold}
                onChange={(e) => setConfig({ ...config, quorumThreshold: parseInt(e.target.value) || 0 })}
                min={1}
                className="w-full px-3 py-2 border border-border-hover rounded-md focus:ring-2 focus:ring-ring focus:border-ring"
              />
              <p className="mt-1 text-xs text-foreground-muted">
                Minimum total voting power required for a proposal to pass
              </p>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Review & Deploy</h2>

            <div className="bg-background-secondary p-4 rounded-md space-y-2">
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Cloak Name</span>
                <span className="font-medium">{config.name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Admin</span>
                <span className="font-mono text-sm">
                  {userAddress ? `${userAddress.slice(0, 10)}...` : '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Voting Duration</span>
                <span className="font-medium">{config.votingDuration} blocks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-foreground-secondary">Quorum Threshold</span>
                <span className="font-medium">{config.quorumThreshold}</span>
              </div>
            </div>

            {/* Rate Limit Status */}
            {rateLimitStatus && (
              <div className={`p-3 rounded-md text-sm ${
                rateLimitStatus.remainingDeployments > 0
                  ? 'bg-status-info/10 border border-status-info text-status-info'
                  : 'bg-status-warning/10 border border-status-warning text-status-warning'
              }`}>
                {rateLimitStatus.remainingDeployments > 0 ? (
                  <p>
                    You have <span className="font-semibold">{rateLimitStatus.remainingDeployments}</span> Cloak
                    deployment{rateLimitStatus.remainingDeployments === 1 ? '' : 's'} remaining this hour.
                  </p>
                ) : (
                  <p>
                    Rate limit reached. You can deploy again at{' '}
                    <span className="font-semibold">
                      {rateLimitStatus.nextResetTime?.toLocaleTimeString()}
                    </span>.
                  </p>
                )}
              </div>
            )}

            <p className="text-sm text-foreground-muted">
              Deploying a Cloak will create a smart contract on the Aztec network.
              This action cannot be undone.
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
          disabled={currentStep === 0 || isLoading}
          className="px-4 py-2 text-foreground-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            disabled={currentStep === 0 && !config.name}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleDeploy}
            disabled={isLoading || !config.name || (rateLimitStatus?.remainingDeployments === 0)}
            className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Deploying...' : 'Deploy Cloak'}
          </button>
        )}
      </div>
    </div>
  );
}
