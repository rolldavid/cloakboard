/**
 * Passkey Auth Service
 *
 * WebAuthn register/authenticate ceremonies.
 * Credential IDs stored in localStorage for discovery.
 * No server required — purely client-side WebAuthn.
 */

const STORAGE_KEY = 'passkey_credentials';
const RP_NAME = 'DuelCloak';

interface StoredCredential {
  id: string; // base64url credential ID
  createdAt: number;
}

export class PasskeyAuthService {
  static isSupported(): boolean {
    return typeof window !== 'undefined'
      && !!window.PublicKeyCredential
      && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
  }

  static hasStoredCredentials(): boolean {
    return this.getStoredCredentials().length > 0;
  }

  static getStoredCredentials(): StoredCredential[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private static saveCredential(credential: StoredCredential): void {
    const existing = this.getStoredCredentials();
    const updated = existing.filter(c => c.id !== credential.id);
    updated.push(credential);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  static async register(): Promise<string> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: RP_NAME,
          id: window.location.hostname,
        },
        user: {
          id: userId,
          name: 'DuelCloak User',
          displayName: 'DuelCloak User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (!credential) {
      throw new Error('Passkey registration was cancelled');
    }

    const credentialId = this.arrayBufferToBase64Url(credential.rawId);
    this.saveCredential({ id: credentialId, createdAt: Date.now() });

    return credentialId;
  }

  static async authenticate(): Promise<string> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const storedCredentials = this.getStoredCredentials();

    const allowCredentials: PublicKeyCredentialDescriptor[] = storedCredentials.map(c => ({
      type: 'public-key',
      id: this.base64UrlToArrayBuffer(c.id),
    }));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
        userVerification: 'required',
        timeout: 60000,
      },
    }) as PublicKeyCredential | null;

    if (!assertion) {
      throw new Error('Passkey authentication was cancelled');
    }

    const credentialId = this.arrayBufferToBase64Url(assertion.rawId);

    // Store credential if it's new (discoverable credential flow)
    if (!storedCredentials.some(c => c.id === credentialId)) {
      this.saveCredential({ id: credentialId, createdAt: Date.now() });
    }

    return credentialId;
  }

  static storeSession(credentialId: string): void {
    sessionStorage.setItem('passkey_auth', JSON.stringify({ credentialId }));
  }

  static getStoredSession(): { credentialId: string } | null {
    try {
      const stored = sessionStorage.getItem('passkey_auth');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  static clearSession(): void {
    sessionStorage.removeItem('passkey_auth');
  }

  static clearAllCredentials(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.clearSession();
  }

  private static arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private static base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    if (padding) base64 += '='.repeat(4 - padding);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
