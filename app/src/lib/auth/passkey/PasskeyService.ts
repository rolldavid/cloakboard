/**
 * Passkey Service
 *
 * WebAuthn credential management for passkey authentication.
 * Uses navigator.credentials API for Face ID, Touch ID, etc.
 *
 * Account Type: ecdsasecp256r1 (P-256 curve, WebAuthn compatible)
 */

import type { PasskeyCredential, PasskeyRegistrationOptions, PasskeyAuthenticationOptions } from '../types';

// RP (Relying Party) configuration
const RP_NAME = 'Cloak';
const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

// WebAuthn algorithm for ES256 (P-256 / secp256r1)
const ES256_ALGORITHM = -7;

export class PasskeyService {
  /**
   * Check if WebAuthn is supported
   */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.PublicKeyCredential !== undefined &&
      typeof window.PublicKeyCredential === 'function'
    );
  }

  /**
   * Check if platform authenticator is available (Face ID, Touch ID, etc.)
   */
  static async isPlatformAuthenticatorAvailable(): Promise<boolean> {
    if (!this.isSupported()) return false;

    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Register a new passkey credential
   *
   * @param options - Registration options including display name
   * @returns PasskeyCredential with public key and credential ID
   */
  static async register(options: PasskeyRegistrationOptions): Promise<PasskeyCredential> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    // Generate random user handle if not provided
    const userHandleArray = options.userHandle || crypto.getRandomValues(new Uint8Array(32));
    const userHandle = new Uint8Array(userHandleArray.buffer, userHandleArray.byteOffset, userHandleArray.byteLength);

    // Generate challenge
    const challengeArray = crypto.getRandomValues(new Uint8Array(32));
    const challenge = new Uint8Array(challengeArray.buffer, challengeArray.byteOffset, challengeArray.byteLength);

    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge: challenge as BufferSource,
      rp: {
        name: RP_NAME,
        id: RP_ID,
      },
      user: {
        id: userHandle as BufferSource,
        name: options.displayName,
        displayName: options.displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: ES256_ALGORITHM }, // ES256 (P-256)
      ],
      authenticatorSelection: {
        // Don't restrict to platform - allows security keys on localhost
        // and falls back gracefully when platform auth isn't available
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none', // We don't need attestation for privacy
    };

    try {
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions,
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Failed to create credential');
      }

      const response = credential.response as AuthenticatorAttestationResponse;

      // Extract public key from attestation
      const publicKey = this.extractPublicKey(response);

      // Get transports if available
      let transports: AuthenticatorTransport[] | undefined;
      if ('getTransports' in response) {
        transports = (response as any).getTransports();
      }

      return {
        credentialId: this.bufferToBase64url(credential.rawId),
        publicKey,
        algorithm: ES256_ALGORITHM,
        transports,
      };
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Passkey registration was cancelled or denied');
        }
        if (error.name === 'InvalidStateError') {
          throw new Error('A passkey already exists for this account');
        }
      }
      throw error;
    }
  }

  /**
   * Authenticate with an existing passkey
   *
   * @param options - Optional credential ID to use specific passkey
   * @returns PasskeyCredential with public key for key derivation
   */
  static async authenticate(options?: PasskeyAuthenticationOptions): Promise<PasskeyCredential> {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser');
    }

    // Generate challenge
    const challengeSource = options?.challenge || crypto.getRandomValues(new Uint8Array(32));
    const challenge = new Uint8Array(challengeSource.buffer, challengeSource.byteOffset, challengeSource.byteLength);

    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge: challenge as BufferSource,
      rpId: RP_ID,
      userVerification: 'required',
      timeout: 60000,
    };

    // If credential ID is provided, only allow that specific credential
    if (options?.credentialId) {
      publicKeyCredentialRequestOptions.allowCredentials = [{
        type: 'public-key',
        id: this.base64urlToBuffer(options.credentialId),
      }];
    }

    try {
      const credential = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions,
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Failed to get credential');
      }

      const credentialId = this.bufferToBase64url(credential.rawId);
      const storedCredential = this.getStoredCredential(credentialId);
      if (!storedCredential) {
        throw new Error(
          'Passkey credential not found locally. This passkey may have been registered on a different device.'
        );
      }

      return {
        credentialId,
        publicKey: storedCredential.publicKey,
        algorithm: ES256_ALGORITHM,
      };
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Passkey authentication was cancelled or denied');
        }
        if (error.name === 'SecurityError') {
          throw new Error('The origin is not allowed to use WebAuthn');
        }
      }
      throw error;
    }
  }

  /**
   * Extract public key from attestation response
   */
  private static extractPublicKey(response: AuthenticatorAttestationResponse): Uint8Array {
    // Parse the attestation object to get the public key
    const attestationObject = response.attestationObject;

    // The public key is in COSE format in the authData
    // For simplicity, we'll use the raw public key from getPublicKey() if available
    if ('getPublicKey' in response) {
      const publicKey = (response as any).getPublicKey();
      if (publicKey) {
        return new Uint8Array(publicKey);
      }
    }

    // Fallback: hash the attestation object to get a deterministic key
    // This is used when getPublicKey() is not available
    return new Uint8Array(attestationObject.slice(0, 65));
  }

  /**
   * Convert ArrayBuffer to base64url string
   */
  private static bufferToBase64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Convert base64url string to ArrayBuffer
   */
  private static base64urlToBuffer(base64url: string): ArrayBuffer {
    const base64 = base64url
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Store credential metadata in localStorage for later retrieval
   */
  static storeCredential(credential: PasskeyCredential): void {
    const stored = this.getStoredCredentials();
    // Convert Uint8Array to ArrayBuffer for storage
    const buffer = credential.publicKey.buffer.slice(
      credential.publicKey.byteOffset,
      credential.publicKey.byteOffset + credential.publicKey.byteLength
    );
    stored[credential.credentialId] = {
      publicKey: this.bufferToBase64url(buffer as ArrayBuffer),
      algorithm: credential.algorithm,
      transports: credential.transports,
      createdAt: Date.now(),
    };
    localStorage.setItem('passkey_credentials', JSON.stringify(stored));
  }

  /**
   * Get stored credential by ID
   */
  static getStoredCredential(credentialId: string): PasskeyCredential | null {
    const stored = this.getStoredCredentials();
    const data = stored[credentialId];
    if (!data) return null;

    return {
      credentialId,
      publicKey: new Uint8Array(this.base64urlToBuffer(data.publicKey)),
      algorithm: data.algorithm,
      transports: data.transports,
    };
  }

  /**
   * Get all stored credentials
   */
  private static getStoredCredentials(): Record<string, any> {
    try {
      const stored = localStorage.getItem('passkey_credentials');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  /**
   * Delete stored credential
   */
  static deleteStoredCredential(credentialId: string): void {
    const stored = this.getStoredCredentials();
    delete stored[credentialId];
    localStorage.setItem('passkey_credentials', JSON.stringify(stored));
  }

  /**
   * List all stored credential IDs
   */
  static listStoredCredentialIds(): string[] {
    return Object.keys(this.getStoredCredentials());
  }
}
