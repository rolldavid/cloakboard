/**
 * Secure Vault — Encrypted storage for wallet data using IndexedDB + Web Crypto API.
 *
 * Security: AES-256-GCM encryption, PBKDF2 key derivation (600k iterations).
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { VaultData, EncryptedVault } from '@/types/wallet';

const DB_NAME = 'duelcloak-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vaults';
const PBKDF2_ITERATIONS = 600_000;

export class SecureVault {
  private db: IDBPDatabase | null = null;

  async initialize(): Promise<void> {
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'networkId' });
        }
      },
    });
  }

  private ensureInitialized(): void {
    if (!this.db) throw new Error('Vault not initialized. Call initialize() first.');
  }

  private async deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
      'raw', encoder.encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async saveVault(networkId: string, password: string, data: VaultData): Promise<void> {
    this.ensureInitialized();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt.buffer);
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource);

    const vault: EncryptedVault = { version: 2, salt: salt.buffer, iv: iv.buffer, ciphertext, networkId };
    await this.db!.put(STORE_NAME, vault);
  }

  async loadVault(networkId: string, password: string): Promise<VaultData | null> {
    this.ensureInitialized();
    const vault = await this.db!.get(STORE_NAME, networkId) as EncryptedVault | undefined;
    if (!vault) return null;

    try {
      const key = await this.deriveKey(password, vault.salt);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vault.iv }, key, vault.ciphertext);
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error('Invalid password or corrupted vault');
    }
  }

  async hasVault(networkId: string): Promise<boolean> {
    this.ensureInitialized();
    const vault = await this.db!.get(STORE_NAME, networkId);
    return vault !== undefined;
  }

  async deleteVault(networkId: string): Promise<void> {
    this.ensureInitialized();
    await this.db!.delete(STORE_NAME, networkId);
  }

}

let vaultInstance: SecureVault | null = null;

export function getVaultInstance(): SecureVault {
  if (!vaultInstance) vaultInstance = new SecureVault();
  return vaultInstance;
}
