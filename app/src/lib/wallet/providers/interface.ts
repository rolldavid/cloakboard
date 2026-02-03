/**
 * Wallet Provider Interface
 *
 * Abstract interface for wallet providers.
 * Allows swapping between embedded wallet, browser extension, and hardware wallet.
 */

export type ProviderType = 'embedded' | 'extension' | 'hardware';

export interface WalletProviderInterface {
  /** Type of provider */
  readonly type: ProviderType;

  /** Connect to the wallet and return the address */
  connect(): Promise<string>;

  /** Disconnect from the wallet */
  disconnect(): Promise<void>;

  /** Get current connected address */
  getAddress(): string | null;

  /** Check if wallet is connected */
  isConnected(): boolean;

  /** Get all available accounts */
  getAccounts(): Promise<string[]>;

  /** Switch to a different account */
  switchAccount(address: string): Promise<void>;

  /** Sign a message (returns signature) */
  signMessage?(message: Uint8Array): Promise<Uint8Array>;

  /** Check if provider is available */
  isAvailable(): boolean;
}

/**
 * Events emitted by wallet providers
 */
export type WalletProviderEvent =
  | { type: 'connected'; address: string }
  | { type: 'disconnected' }
  | { type: 'accountChanged'; address: string }
  | { type: 'networkChanged'; networkId: string }
  | { type: 'error'; error: Error };

export type WalletProviderEventHandler = (event: WalletProviderEvent) => void;

/**
 * Extended interface with event support
 */
export interface WalletProviderWithEvents extends WalletProviderInterface {
  /** Subscribe to provider events */
  on(handler: WalletProviderEventHandler): () => void;

  /** Emit an event */
  emit(event: WalletProviderEvent): void;
}

/**
 * Base class for wallet providers with event support
 */
export abstract class BaseWalletProvider implements WalletProviderWithEvents {
  abstract readonly type: ProviderType;

  protected handlers: Set<WalletProviderEventHandler> = new Set();
  protected currentAddress: string | null = null;

  abstract connect(): Promise<string>;
  abstract disconnect(): Promise<void>;
  abstract getAccounts(): Promise<string[]>;
  abstract switchAccount(address: string): Promise<void>;
  abstract isAvailable(): boolean;

  getAddress(): string | null {
    return this.currentAddress;
  }

  isConnected(): boolean {
    return this.currentAddress !== null;
  }

  on(handler: WalletProviderEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: WalletProviderEvent): void {
    this.handlers.forEach(handler => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in wallet provider event handler:', error);
      }
    });
  }

  protected setAddress(address: string | null): void {
    const previousAddress = this.currentAddress;
    this.currentAddress = address;

    if (address && address !== previousAddress) {
      this.emit({ type: 'accountChanged', address });
    }
  }
}
