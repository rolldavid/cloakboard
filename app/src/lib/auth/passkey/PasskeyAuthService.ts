/**
 * Passkey Auth Service
 *
 * WebAuthn register/authenticate ceremonies.
 * Credential IDs stored in localStorage for discovery.
 * No server required — purely client-side WebAuthn.
 */

const STORAGE_KEY = 'passkey_credentials';
const RP_NAME = 'Cloakboard';

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

    // Firefox Android hangs with authenticatorAttachment: 'platform' — omit on Firefox Android
    // to let the Android Credential Manager handle transport selection.
    const isFirefoxAndroid = /Android/i.test(navigator.userAgent) && /Firefox/i.test(navigator.userAgent);

    const authenticatorSelection: AuthenticatorSelectionCriteria = {
      userVerification: 'required',
      residentKey: 'preferred',
    };
    if (!isFirefoxAndroid) {
      authenticatorSelection.authenticatorAttachment = 'platform';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: RP_NAME,
            id: window.location.hostname,
          },
          user: {
            id: userId,
            name: 'Cloakboard User',
            displayName: 'Cloakboard User',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },   // ES256
            { alg: -257, type: 'public-key' },  // RS256
          ],
          authenticatorSelection,
          timeout: 60000,
        },
        signal: controller.signal,
      }) as PublicKeyCredential | null;

      if (!credential) {
        throw new Error('Passkey registration was cancelled');
      }

      const credentialId = this.arrayBufferToBase64Url(credential.rawId);
      this.saveCredential({ id: credentialId, createdAt: Date.now() });

      return credentialId;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Registration timed out. Please try again or use a different sign-in method.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static async authenticate(): Promise<string> {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const storedCredentials = this.getStoredCredentials();

    // transports: ['internal'] hints the browser to use the platform authenticator directly,
    // improving compatibility with Firefox Android's credential manager delegation.
    const allowCredentials: PublicKeyCredentialDescriptor[] = storedCredentials.map(c => ({
      type: 'public-key',
      id: this.base64UrlToArrayBuffer(c.id),
      transports: ['internal' as AuthenticatorTransport],
    }));

    // AbortController catches Firefox Android's WebAuthn hang — the biometric prompt
    // completes but the promise never resolves. Without this, the UI shows
    // "Waiting for device..." indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
          userVerification: 'required',
          timeout: 30000,
        },
        signal: controller.signal,
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
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('Authentication timed out. Please try again or use a different sign-in method.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
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
