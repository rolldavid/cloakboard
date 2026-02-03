/**
 * Deployment Service
 *
 * Handles sponsored account deployment using Fee Paying Contract (FPC).
 * Deploys accounts in the background after successful authentication.
 */

import type { NetworkConfig, DerivedKeys, AccountType } from '@/types/wallet';
import { getAccountService } from './accountService';

export type DeploymentStatus = 'pending' | 'deploying' | 'deployed' | 'failed';

export interface DeploymentState {
  status: DeploymentStatus;
  address: string | null;
  txHash: string | null;
  error: string | null;
}

type DeploymentListener = (state: DeploymentState) => void;

/**
 * Deployment Service
 *
 * Manages sponsored account deployment using FPC (Fee Paying Contract).
 */
export class DeploymentService {
  private network: NetworkConfig;
  private listeners: Set<DeploymentListener> = new Set();
  private deploymentState: Map<string, DeploymentState> = new Map();

  constructor(network: NetworkConfig) {
    this.network = network;
  }

  /**
   * Check if account is deployed on-chain
   */
  async isDeployed(address: string): Promise<boolean> {
    try {
      const accountService = getAccountService(this.network);

      // Initialize account service first (needed for node connection)
      await accountService.initialize();

      const deployed = await accountService.isAccountDeployed(address);
      return deployed;
    } catch (error) {
      console.warn('[DeploymentService] Failed to check deployment status:', error);
      // On error, we can't be sure - return false but log it
      // This is safer than assuming deployed and skipping
      return false;
    }
  }

  /**
   * Deploy account with sponsored fees
   *
   * Uses the network's FPC (Fee Paying Contract) to sponsor the deployment.
   * This allows users to deploy accounts without holding any tokens.
   */
  async deployWithSponsoredFees(
    keys: DerivedKeys,
    address: string,
    accountType: AccountType = 'schnorr'
  ): Promise<DeploymentState> {
    // Check if already deploying or deployed
    const existing = this.deploymentState.get(address);
    if (existing?.status === 'deploying') {
      return existing;
    }

    if (existing?.status === 'deployed') {
      return existing;
    }

    // Check if already deployed on-chain
    const isAlreadyDeployed = await this.isDeployed(address);
    if (isAlreadyDeployed) {
      const state: DeploymentState = {
        status: 'deployed',
        address,
        txHash: null,
        error: null,
      };
      this.deploymentState.set(address, state);
      this.notifyListeners(state);
      return state;
    }

    // Note: In sandbox mode, we can deploy without an FPC
    // The FPC is only strictly required for production (testnet/mainnet)
    if (!this.network.sponsoredFpcAddress) {
    }

    // Update state to deploying
    const deployingState: DeploymentState = {
      status: 'deploying',
      address,
      txHash: null,
      error: null,
    };
    this.deploymentState.set(address, deployingState);
    this.notifyListeners(deployingState);

    try {
      const accountService = getAccountService(this.network);

      // Initialize the account service (connects to node)
      await accountService.initialize();

      // Deploy using sponsored fees
      const deployedAddress = await accountService.deployAccount(keys, accountType);

      const successState: DeploymentState = {
        status: 'deployed',
        address: deployedAddress,
        txHash: null, // Could extract from deployment receipt
        error: null,
      };
      this.deploymentState.set(address, successState);
      this.notifyListeners(successState);

      return successState;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if error indicates account already exists (this is actually success)
      if (errorMessage.includes('Existing nullifier') || errorMessage.includes('already deployed')) {
        const successState: DeploymentState = {
          status: 'deployed',
          address,
          txHash: null,
          error: null,
        };
        this.deploymentState.set(address, successState);
        this.notifyListeners(successState);
        return successState;
      }

      console.error('[DeploymentService] Deployment failed:', error);

      const failedState: DeploymentState = {
        status: 'failed',
        address,
        txHash: null,
        error: errorMessage,
      };
      this.deploymentState.set(address, failedState);
      this.notifyListeners(failedState);

      return failedState;
    }
  }

  /**
   * Get deployment state for an address
   */
  getState(address: string): DeploymentState | null {
    return this.deploymentState.get(address) || null;
  }

  /**
   * Subscribe to deployment state changes
   */
  subscribe(listener: DeploymentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify listeners of state change
   */
  private notifyListeners(state: DeploymentState): void {
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[DeploymentService] Error in listener:', error);
      }
    });
  }
}

// Singleton instances per network
const deploymentServices: Map<string, DeploymentService> = new Map();

export function getDeploymentService(network: NetworkConfig): DeploymentService {
  const key = network.id;

  if (!deploymentServices.has(key)) {
    deploymentServices.set(key, new DeploymentService(network));
  }

  return deploymentServices.get(key)!;
}
