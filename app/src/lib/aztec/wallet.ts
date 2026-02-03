/**
 * Legacy Wallet Service
 *
 * @deprecated Use AztecClient from './client' instead.
 * This file is kept for backward compatibility but all functionality
 * has been moved to AztecClient.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import { AztecClient } from './client';

export interface AccountInfo {
  address: string;
  publicKey: string;
  isDeployed: boolean;
}

export interface WalletState {
  isConnected: boolean;
  account: AccountInfo | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * @deprecated Use AztecClient directly instead.
 */
export class WalletService {
  private client: AztecClient;

  constructor(client: AztecClient) {
    this.client = client;
  }

  async createAccount(): Promise<AccountInfo> {
    const { address } = await this.client.createAccount();
    return {
      address: address.toString(),
      publicKey: address.toString(), // Public key derived from address
      isDeployed: false,
    };
  }

  async deployAccount(): Promise<AccountInfo> {
    const address = await this.client.deployAccount();
    return {
      address: address.toString(),
      publicKey: address.toString(),
      isDeployed: true,
    };
  }

  async importAccount(secretKeyHex: string): Promise<AccountInfo> {
    // For import, we need all three keys. This legacy method only takes secretKey,
    // so we'll throw an error directing users to use the new API.
    throw new Error(
      'importAccount is deprecated. Use AztecClient.importAccountFromHex() with secretKey, signingKey, and salt.'
    );
  }

  async checkAccountDeployed(address: AztecAddress): Promise<boolean> {
    return this.client.isAccountDeployed(address);
  }

  getAddress(): AztecAddress | null {
    return this.client.getAddress();
  }

  getAccount(): any {
    return this.client.hasWallet() ? this.client.getWallet() : null;
  }

  getSecretKey(): any {
    const keys = this.client.getAccountKeys();
    return keys?.secretKey ?? null;
  }

  exportSecretKey(): string | null {
    const keysHex = this.client.exportAccountKeysHex();
    return keysHex?.secretKey ?? null;
  }

  disconnect(): void {
    this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.hasWallet();
  }
}
