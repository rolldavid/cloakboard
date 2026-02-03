/**
 * Embedded Wallet Provider
 *
 * Built-in wallet provider that manages keys locally.
 * Uses the WalletManager for key management and account operations.
 */

import { BaseWalletProvider } from './interface';
import type { NetworkConfig } from '@/types/wallet';
import { WalletManager, getWalletManager } from '../walletManager';

export class EmbeddedWalletProvider extends BaseWalletProvider {
  readonly type = 'embedded' as const;

  private walletManager: WalletManager;
  private network: NetworkConfig;

  constructor(network: NetworkConfig) {
    super();
    this.network = network;
    this.walletManager = getWalletManager(network);
  }

  /**
   * Check if embedded wallet is available (always true in browser)
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof crypto !== 'undefined';
  }

  /**
   * Connect to the embedded wallet
   * Note: This requires the wallet to be unlocked first
   */
  async connect(): Promise<string> {
    const state = await this.walletManager.getState();

    if (state.status === 'no_wallet') {
      throw new Error('No wallet found. Create or import a wallet first.');
    }

    if (state.status === 'locked') {
      throw new Error('Wallet is locked. Unlock it first.');
    }

    if (!state.address) {
      throw new Error('No account address available.');
    }

    this.setAddress(state.address);
    this.emit({ type: 'connected', address: state.address });

    return state.address;
  }

  /**
   * Disconnect (lock the wallet)
   */
  async disconnect(): Promise<void> {
    this.walletManager.lock();
    this.setAddress(null);
    this.emit({ type: 'disconnected' });
  }

  /**
   * Get all accounts from the wallet
   */
  async getAccounts(): Promise<string[]> {
    const accounts = this.walletManager.getAccounts();
    return accounts.map(a => a.address);
  }

  /**
   * Switch to a different account
   */
  async switchAccount(address: string): Promise<void> {
    const accounts = this.walletManager.getAccounts();
    const account = accounts.find(a => a.address === address);

    if (!account) {
      throw new Error(`Account not found: ${address}`);
    }

    // Note: In a full implementation, this would switch the active account
    // For now, we just update the address
    this.setAddress(address);
    this.emit({ type: 'accountChanged', address });
  }

  /**
   * Get the wallet manager for advanced operations
   */
  getWalletManager(): WalletManager {
    return this.walletManager;
  }

  /**
   * Get the network configuration
   */
  getNetwork(): NetworkConfig {
    return this.network;
  }
}
