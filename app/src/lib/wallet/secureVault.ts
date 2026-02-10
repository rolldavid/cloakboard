/**
 * Secure Vault
 *
 * Encrypted storage for wallet data using IndexedDB + Web Crypto API.
 * Follows demo-wallet pattern of per-network vault isolation.
 *
 * Security features:
 * - AES-256-GCM encryption
 * - PBKDF2 key derivation (600k iterations per OWASP 2023)
 * - Per-network isolation
 * - Automatic integrity verification via GCM auth tag
 */

import { openDB, IDBPDatabase } from 'idb';
import type { VaultData, EncryptedVault, LinkedVaultRedirect } from '@/types/wallet';

const DB_NAME = 'private-cloak-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vaults';

// OWASP 2023 recommendation for PBKDF2 iterations
const PBKDF2_ITERATIONS = 600_000;

export class SecureVault {
  private db: IDBPDatabase | null = null;

  /**
   * Initialize the vault database
   */
  async initialize(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'networkId' });
        }
      },
    });
  }

  /**
   * Ensure database is initialized
   */
  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Vault not initialized. Call initialize() first.');
    }
  }

  /**
   * Derive encryption key from password using PBKDF2
   */
  private async deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Save vault with network isolation
   * Following demo-wallet pattern of separate vaults per network
   */
  async saveVault(
    networkId: string,
    password: string,
    data: VaultData
  ): Promise<void> {
    this.ensureInitialized();

    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive encryption key
    const key = await this.deriveKey(password, salt.buffer);

    // Encrypt vault data
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(data));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );

    // Store encrypted vault
    const vault: EncryptedVault = {
      version: 2,
      salt: salt.buffer,
      iv: iv.buffer,
      ciphertext,
      networkId,
    };

    await this.db!.put(STORE_NAME, vault);
  }

  /**
   * Load and decrypt vault for specific network
   */
  async loadVault(networkId: string, password: string): Promise<VaultData | null> {
    this.ensureInitialized();

    const vault = await this.db!.get(STORE_NAME, networkId) as EncryptedVault | undefined;
    if (!vault) return null;

    try {
      // Derive decryption key
      const key = await this.deriveKey(password, vault.salt);

      // Decrypt vault data
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: vault.iv },
        key,
        vault.ciphertext
      );

      // Parse and return
      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(plaintext));
    } catch (error) {
      // Decryption failed - wrong password or corrupted data
      throw new Error('Invalid password or corrupted vault');
    }
  }

  /**
   * Check if vault exists for network
   */
  async hasVault(networkId: string): Promise<boolean> {
    this.ensureInitialized();
    const vault = await this.db!.get(STORE_NAME, networkId);
    return vault !== undefined;
  }

  /**
   * List all networks with vaults
   */
  async listNetworks(): Promise<string[]> {
    this.ensureInitialized();
    const keys = await this.db!.getAllKeys(STORE_NAME);
    return keys as string[];
  }

  /**
   * Delete vault for network
   */
  async deleteVault(networkId: string): Promise<void> {
    this.ensureInitialized();
    await this.db!.delete(STORE_NAME, networkId);
  }

  /**
   * Delete a vault entry by its raw composite key (used by unlinkAccount to
   * remove redirect vaults).
   */
  async deleteByKey(key: string): Promise<void> {
    this.ensureInitialized();
    await this.db!.delete(STORE_NAME, key);
  }

  /**
   * Compute the composite key used for a linked vault redirect entry.
   * Exposed so AuthManager can store it alongside the LinkedAuthMethod record.
   */
  getLinkedVaultKey(networkId: string, vaultPassword: string): string {
    return `${networkId}::linked::${this.hashKey(vaultPassword)}`;
  }

  /**
   * Update vault data (requires password for re-encryption)
   */
  async updateVault(
    networkId: string,
    password: string,
    updateFn: (data: VaultData) => VaultData
  ): Promise<void> {
    const data = await this.loadVault(networkId, password);
    if (!data) {
      throw new Error('No vault found for network');
    }

    const updatedData = updateFn(data);
    await this.saveVault(networkId, password, updatedData);
  }

  /**
   * Add a linked Ethereum address to the vault
   */
  async addLinkedEthAddress(
    networkId: string,
    password: string,
    ethAddress: string
  ): Promise<void> {
    await this.updateVault(networkId, password, (data) => {
      const linked = data.linkedEthAddresses ?? [];
      const normalized = ethAddress.toLowerCase();
      if (!linked.includes(normalized)) {
        linked.push(normalized);
      }
      return { ...data, linkedEthAddresses: linked };
    });
  }

  /**
   * Save a linked vault redirect (encrypted with the linked method's keys).
   * Uses a composite key scheme: `${networkId}::linked::${hash}` so it
   * coexists with primary vaults in the same IndexedDB store.
   */
  async saveLinkedVault(
    networkId: string,
    vaultPassword: string,
    data: LinkedVaultRedirect
  ): Promise<void> {
    const compositeKey = `${networkId}::linked::${this.hashKey(vaultPassword)}`;
    // Reuse saveVault's encryption by wrapping the redirect data as VaultData-shaped JSON
    const wrappedData = {
      vaultType: 'linked' as const,
      redirect: data,
    };

    this.ensureInitialized();

    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(vaultPassword, salt.buffer);
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(JSON.stringify(wrappedData));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );

    const vault = {
      version: 2,
      salt: salt.buffer,
      iv: iv.buffer,
      ciphertext,
      networkId: compositeKey,
    };

    await this.db!.put(STORE_NAME, vault);
  }

  /**
   * Try to load a linked vault redirect (decrypted with the linked method's keys).
   * Returns null if no redirect vault exists for this key.
   */
  async loadLinkedVault(
    networkId: string,
    vaultPassword: string
  ): Promise<LinkedVaultRedirect | null> {
    this.ensureInitialized();

    const compositeKey = `${networkId}::linked::${this.hashKey(vaultPassword)}`;
    const vault = await this.db!.get(STORE_NAME, compositeKey) as EncryptedVault | undefined;
    if (!vault) return null;

    try {
      const key = await this.deriveKey(vaultPassword, vault.salt);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: vault.iv },
        key,
        vault.ciphertext
      );
      const decoder = new TextDecoder();
      const parsed = JSON.parse(decoder.decode(plaintext));
      if (parsed.vaultType !== 'linked') return null;
      return parsed.redirect as LinkedVaultRedirect;
    } catch {
      return null;
    }
  }

  /**
   * Simple hash of a key string for use in composite IndexedDB keys.
   * Not cryptographic — just avoids storing raw vault passwords in IDB keys.
   */
  private hashKey(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Change vault password
   */
  async changePassword(
    networkId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const data = await this.loadVault(networkId, currentPassword);
    if (!data) {
      throw new Error('No vault found for network');
    }

    await this.saveVault(networkId, newPassword, data);
  }

  /**
   * Export vault data (for backup)
   * Returns the raw encrypted vault for external storage
   */
  async exportVault(networkId: string): Promise<string | null> {
    this.ensureInitialized();
    const vault = await this.db!.get(STORE_NAME, networkId) as EncryptedVault | undefined;
    if (!vault) return null;

    // Convert ArrayBuffers to base64 for JSON serialization
    return JSON.stringify({
      version: vault.version,
      networkId: vault.networkId,
      salt: this.arrayBufferToBase64(vault.salt),
      iv: this.arrayBufferToBase64(vault.iv),
      ciphertext: this.arrayBufferToBase64(vault.ciphertext),
    });
  }

  /**
   * Import vault from backup
   */
  async importVault(exportedVault: string): Promise<void> {
    this.ensureInitialized();

    const parsed = JSON.parse(exportedVault);

    const vault: EncryptedVault = {
      version: parsed.version,
      networkId: parsed.networkId,
      salt: this.base64ToArrayBuffer(parsed.salt),
      iv: this.base64ToArrayBuffer(parsed.iv),
      ciphertext: this.base64ToArrayBuffer(parsed.ciphertext),
    };

    await this.db!.put(STORE_NAME, vault);
  }

  // Helper methods for base64 conversion
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// Singleton instance
let vaultInstance: SecureVault | null = null;

export function getVaultInstance(): SecureVault {
  if (!vaultInstance) {
    vaultInstance = new SecureVault();
  }
  return vaultInstance;
}
