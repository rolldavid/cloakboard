/**
 * Key Derivation Service
 *
 * Derives Aztec keys from BIP39 mnemonic using HKDF.
 * This is a critical improvement over demo-wallet which lacks mnemonic recovery.
 *
 * Derivation path concept:
 * mnemonic → BIP39 seed (512 bits) → HKDF with domain separation → Aztec keys
 */

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import type { AccountType, DerivedKeys } from '@/types/wallet';

// Domain separation for Aztec key derivation
// This ensures keys are unique to this application
const AZTEC_KEY_DOMAIN = 'aztec.network/private-cloak/v1';

export class KeyDerivationService {
  /**
   * Generate new wallet with 24-word mnemonic (256 bits entropy)
   */
  static generateMnemonic(): string {
    return bip39.generateMnemonic(wordlist, 256);
  }

  /**
   * Validate mnemonic phrase
   */
  static validateMnemonic(mnemonic: string): boolean {
    const normalized = mnemonic.trim().toLowerCase();
    return bip39.validateMnemonic(normalized, wordlist);
  }

  /**
   * Normalize mnemonic (trim, lowercase, single spaces)
   */
  static normalizeMnemonic(mnemonic: string): string {
    return mnemonic
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .join(' ');
  }

  /**
   * Derive Aztec keys from mnemonic
   *
   * This ensures:
   * - Same mnemonic always produces same keys (deterministic)
   * - Different account indices produce different keys
   * - Different account types produce different keys
   *
   * @param mnemonic - 24-word BIP39 mnemonic
   * @param accountIndex - Account index for HD-like derivation
   * @param accountType - Type of account (schnorr, ecdsa, etc.)
   */
  static deriveKeys(
    mnemonic: string,
    accountIndex: number = 0,
    accountType: AccountType = 'schnorr'
  ): DerivedKeys {
    const normalized = this.normalizeMnemonic(mnemonic);

    if (!this.validateMnemonic(normalized)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Convert mnemonic to seed (512 bits)
    const seed = bip39.mnemonicToSeedSync(normalized);

    // Derive each key with unique info string for domain separation
    // Using HKDF-SHA256 with different info strings ensures key independence
    const secretKeyBytes = hkdf(
      sha256,
      seed,
      `${AZTEC_KEY_DOMAIN}/secret`,
      `account/${accountIndex}/${accountType}`,
      32
    );

    const signingKeyBytes = hkdf(
      sha256,
      seed,
      `${AZTEC_KEY_DOMAIN}/signing`,
      `account/${accountIndex}/${accountType}`,
      32
    );

    const saltBytes = hkdf(
      sha256,
      seed,
      `${AZTEC_KEY_DOMAIN}/salt`,
      `account/${accountIndex}/${accountType}`,
      32
    );

    return {
      secretKey: new Uint8Array(secretKeyBytes),
      signingKey: new Uint8Array(signingKeyBytes),
      salt: new Uint8Array(saltBytes),
    };
  }

  /**
   * Derive multiple accounts from same mnemonic
   */
  static deriveMultipleAccounts(
    mnemonic: string,
    count: number,
    accountType: AccountType = 'schnorr'
  ): DerivedKeys[] {
    return Array.from({ length: count }, (_, i) =>
      this.deriveKeys(mnemonic, i, accountType)
    );
  }

  /**
   * Get word count from mnemonic
   */
  static getWordCount(mnemonic: string): number {
    return mnemonic.trim().split(/\s+/).length;
  }

  /**
   * Check if mnemonic has valid word count (12, 15, 18, 21, or 24)
   */
  static hasValidWordCount(mnemonic: string): boolean {
    const count = this.getWordCount(mnemonic);
    return [12, 15, 18, 21, 24].includes(count);
  }

  /**
   * Get autocomplete suggestions for partial word
   */
  static getWordSuggestions(partialWord: string, limit: number = 5): string[] {
    if (!partialWord || partialWord.length < 2) return [];

    const lower = partialWord.toLowerCase();
    return wordlist
      .filter(word => word.startsWith(lower))
      .slice(0, limit);
  }

  /**
   * Check if a word is in the BIP39 wordlist
   */
  static isValidWord(word: string): boolean {
    return wordlist.includes(word.toLowerCase());
  }

  /**
   * Get all invalid words from mnemonic
   */
  static getInvalidWords(mnemonic: string): string[] {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    return words.filter(word => !this.isValidWord(word));
  }

  /**
   * Securely clear a Uint8Array (overwrite with zeros)
   */
  static secureWipe(data: Uint8Array): void {
    data.fill(0);
  }

  /**
   * Securely clear derived keys
   */
  static wipeKeys(keys: DerivedKeys): void {
    this.secureWipe(keys.secretKey);
    this.secureWipe(keys.signingKey);
    this.secureWipe(keys.salt);
  }
}
