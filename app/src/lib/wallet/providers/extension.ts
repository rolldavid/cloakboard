/**
 * Extension Wallet Provider
 *
 * Future: Browser extension wallet provider.
 * This will connect to an Aztec browser extension when available.
 */

import { BaseWalletProvider } from './interface';

// Type declaration for window.aztec (future)
declare global {
  interface Window {
    aztec?: {
      isConnected: () => boolean;
      connect: () => Promise<string>;
      disconnect: () => Promise<void>;
      getAccounts: () => Promise<string[]>;
      switchAccount: (address: string) => Promise<void>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      off: (event: string, handler: (...args: any[]) => void) => void;
    };
  }
}

export class ExtensionWalletProvider extends BaseWalletProvider {
  readonly type = 'extension' as const;

  /**
   * Check if an Aztec browser extension is available
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'aztec' in window && window.aztec !== undefined;
  }

  /**
   * Connect to the browser extension wallet
   */
  async connect(): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Aztec browser extension not available');
    }

    try {
      const address = await window.aztec!.connect();
      this.setAddress(address);
      this.emit({ type: 'connected', address });

      // Setup event listeners
      this.setupEventListeners();

      return address;
    } catch (error) {
      this.emit({ type: 'error', error: error as Error });
      throw error;
    }
  }

  /**
   * Disconnect from the browser extension
   */
  async disconnect(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Aztec browser extension not available');
    }

    try {
      await window.aztec!.disconnect();
      this.setAddress(null);
      this.emit({ type: 'disconnected' });
    } catch (error) {
      this.emit({ type: 'error', error: error as Error });
      throw error;
    }
  }

  /**
   * Get all accounts from the extension
   */
  async getAccounts(): Promise<string[]> {
    if (!this.isAvailable()) {
      throw new Error('Aztec browser extension not available');
    }

    return window.aztec!.getAccounts();
  }

  /**
   * Switch to a different account
   */
  async switchAccount(address: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Aztec browser extension not available');
    }

    await window.aztec!.switchAccount(address);
    this.setAddress(address);
    this.emit({ type: 'accountChanged', address });
  }

  /**
   * Setup event listeners for extension events
   */
  private setupEventListeners(): void {
    if (!window.aztec) return;

    window.aztec.on('accountChanged', (address: string) => {
      this.setAddress(address);
      this.emit({ type: 'accountChanged', address });
    });

    window.aztec.on('disconnect', () => {
      this.setAddress(null);
      this.emit({ type: 'disconnected' });
    });

    window.aztec.on('networkChanged', (networkId: string) => {
      this.emit({ type: 'networkChanged', networkId });
    });
  }
}

/**
 * Check if extension is available without creating an instance
 */
export function isExtensionAvailable(): boolean {
  return typeof window !== 'undefined' && 'aztec' in window && window.aztec !== undefined;
}
