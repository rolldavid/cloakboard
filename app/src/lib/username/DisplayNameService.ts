/**
 * Display Name Service
 *
 * Single source of truth for account-level display names.
 * Display names are stored as hashes on the MultiAuthAccount contract
 * and resolved via a local IndexedDB cache.
 *
 * Privacy model:
 * - Display name hash is public on-chain (on the user's account contract)
 * - Plaintext is stored locally in IndexedDB and resolved client-side
 * - Display names are only revealed when a user takes a public action
 *   (posts a comment, creates a proposal, etc.)
 * - Lurkers who only vote remain completely anonymous
 */

import { setDisplayName, getDisplayNameHash } from '@/lib/auth/MultiAuthAccountContract';

const DB_NAME = 'display_names';
const DB_VERSION = 1;
const STORE_NAME = 'names';

interface DisplayNameEntry {
  /** Account address (key) */
  address: string;
  /** Plaintext display name */
  name: string;
  /** Hash stored on-chain */
  nameHash: string;
  updatedAt: number;
}

/**
 * Hash a display name string into a Field-compatible value.
 * Uses a simple polynomial hash mod 2^254 (same approach as OrganizationCloakService).
 */
export function hashDisplayName(name: string): bigint {
  const encoder = new TextEncoder();
  const data = encoder.encode(name);
  let hash = BigInt(0);
  for (let i = 0; i < data.length; i++) {
    hash = (hash * BigInt(31) + BigInt(data[i])) % (BigInt(2) ** BigInt(254));
  }
  return hash;
}

export class DisplayNameService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async openDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined') {
      throw new Error('DisplayNameService requires browser environment');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'address' });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Set or update the display name for the current user's account.
   * Hashes the name, calls set_display_name on-chain, and caches the plaintext locally.
   *
   * @param wallet - Aztec wallet instance
   * @param accountAddress - The user's account contract address
   * @param name - Plaintext display name
   */
  async setDisplayName(wallet: any, accountAddress: any, name: string): Promise<void> {
    const nameHash = hashDisplayName(name);

    // Write hash on-chain
    const { Fr } = await import('@aztec/foundation/curves/bn254');
    await setDisplayName(wallet, accountAddress, new Fr(nameHash));

    // Cache plaintext locally
    await this.cacheDisplayName(accountAddress.toString(), name, nameHash.toString());
  }

  /**
   * Resolve a display name for a given account address.
   * First checks local cache, then reads the on-chain hash and attempts lookup.
   *
   * @returns The plaintext display name, or null if not resolvable
   */
  async resolveDisplayName(
    wallet: any,
    accountAddress: any,
  ): Promise<string | null> {
    const addressStr = accountAddress.toString();

    // Check local cache first
    const cached = await this.getCachedName(addressStr);
    if (cached) return cached.name;

    // Read on-chain hash
    try {
      const onChainHash = await getDisplayNameHash(wallet, accountAddress);
      if (!onChainHash || onChainHash.toString() === '0') return null;

      // We don't have the plaintext for this hash — it belongs to another user.
      // In a production system, an off-chain indexer would map hashes to names.
      // For now, return null (the UI will show a truncated address instead).
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the locally cached display name for the current user's own account.
   */
  async getOwnDisplayName(accountAddress: string): Promise<string | null> {
    const cached = await this.getCachedName(accountAddress);
    return cached?.name ?? null;
  }

  /**
   * Cache a display name mapping locally.
   */
  async cacheDisplayName(address: string, name: string, nameHash?: string): Promise<void> {
    const effectiveHash = nameHash ?? hashDisplayName(name).toString();
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: DisplayNameEntry = {
        address,
        name,
        nameHash: effectiveHash,
        updatedAt: Date.now(),
      };
      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get a cached name entry by address.
   */
  private async getCachedName(address: string): Promise<DisplayNameEntry | null> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(address);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  /**
   * Clear all cached display names.
   */
  async clearAll(): Promise<void> {
    const db = await this.openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

// Singleton
let displayNameServiceInstance: DisplayNameService | null = null;

export function getDisplayNameService(): DisplayNameService {
  if (!displayNameServiceInstance) {
    displayNameServiceInstance = new DisplayNameService();
  }
  return displayNameServiceInstance;
}
