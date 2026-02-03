/**
 * Session Manager
 *
 * Manages wallet session lifecycle with security features:
 * - Auto-lock on inactivity
 * - Lock on tab visibility change
 * - Secure key memory management
 * - Re-authentication requirements for sensitive operations
 */

import type { SessionConfig, DerivedKeys } from '@/types/wallet';
import { KeyDerivationService } from './keyDerivation';

const DEFAULT_CONFIG: SessionConfig = {
  autoLockTimeout: 15 * 60 * 1000, // 15 minutes
  lockOnHidden: true,
  requireReauthFor: ['deployAccount', 'sendTransaction', 'exportMnemonic', 'changePassword'],
};

type LockCallback = () => void;

export class SessionManager {
  private keys: Map<string, DerivedKeys> = new Map();
  private lastActivity: number = Date.now();
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private config: SessionConfig;
  private onLockCallbacks: Set<LockCallback> = new Set();
  private isLocked: boolean = true;

  constructor(config: Partial<SessionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Only setup tracking in browser environment
    if (typeof window !== 'undefined') {
      this.setupActivityTracking();
      this.setupVisibilityTracking();
      this.setupBeforeUnloadTracking();
    }
  }

  /**
   * Store keys in session (memory only)
   */
  setKeys(networkId: string, keys: DerivedKeys): void {
    // Store a copy to prevent external mutations
    this.keys.set(networkId, {
      secretKey: new Uint8Array(keys.secretKey),
      signingKey: new Uint8Array(keys.signingKey),
      salt: new Uint8Array(keys.salt),
    });
    this.isLocked = false;
    this.touch();
    this.resetLockTimer();
  }

  /**
   * Get keys from session
   */
  getKeys(networkId: string): DerivedKeys | null {
    if (this.isLocked) return null;
    this.touch();
    return this.keys.get(networkId) || null;
  }

  /**
   * Check if session has keys for network
   */
  hasKeys(networkId: string): boolean {
    return !this.isLocked && this.keys.has(networkId);
  }

  /**
   * Check if session is locked
   */
  isSessionLocked(): boolean {
    return this.isLocked;
  }

  /**
   * Clear all keys from memory (secure wipe)
   */
  lock(): void {
    // Overwrite with zeros before clearing (defense in depth)
    for (const [, keys] of this.keys) {
      KeyDerivationService.wipeKeys(keys);
    }
    this.keys.clear();
    this.isLocked = true;

    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }

    // Notify all listeners
    this.onLockCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in lock callback:', error);
      }
    });
  }

  /**
   * Check if operation requires re-authentication
   */
  requiresReauth(operation: string): boolean {
    return this.config.requireReauthFor.includes(operation);
  }

  /**
   * Register callback to be called when session is locked
   */
  onLock(callback: LockCallback): () => void {
    this.onLockCallbacks.add(callback);
    return () => this.onLockCallbacks.delete(callback);
  }

  /**
   * Update session configuration
   */
  updateConfig(config: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...config };
    this.resetLockTimer();
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionConfig {
    return { ...this.config };
  }

  /**
   * Get time until auto-lock (ms)
   */
  getTimeUntilLock(): number {
    if (this.isLocked) return 0;
    const elapsed = Date.now() - this.lastActivity;
    return Math.max(0, this.config.autoLockTimeout - elapsed);
  }

  /**
   * Record activity to reset lock timer
   */
  private touch(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Reset the auto-lock timer
   */
  private resetLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
    }

    if (!this.isLocked && this.config.autoLockTimeout > 0) {
      this.lockTimer = setTimeout(() => {
        this.lock();
      }, this.config.autoLockTimeout);
    }
  }

  /**
   * Setup activity tracking to reset lock timer on user interaction
   */
  private setupActivityTracking(): void {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

    // Throttle touch calls to avoid performance issues
    let lastTouch = 0;
    const throttledTouch = () => {
      const now = Date.now();
      if (now - lastTouch > 30000) { // Only update every 30 seconds
        lastTouch = now;
        this.touch();
        this.resetLockTimer();
      }
    };

    events.forEach(event => {
      window.addEventListener(event, throttledTouch, { passive: true });
    });
  }

  /**
   * Setup visibility tracking to lock when tab is hidden
   */
  private setupVisibilityTracking(): void {
    document.addEventListener('visibilitychange', () => {
      if (this.config.lockOnHidden && document.hidden && !this.isLocked) {
        this.lock();
      }
    });
  }

  /**
   * Setup beforeunload tracking to lock when page is closed
   */
  private setupBeforeUnloadTracking(): void {
    window.addEventListener('beforeunload', () => {
      this.lock();
    });
  }

  /**
   * Manually extend session (for user confirmation dialogs)
   */
  extendSession(additionalTime: number = 5 * 60 * 1000): void {
    this.touch();
    // Temporarily increase timeout
    const originalTimeout = this.config.autoLockTimeout;
    this.config.autoLockTimeout = originalTimeout + additionalTime;
    this.resetLockTimer();
    // Restore original timeout after extension period
    setTimeout(() => {
      this.config.autoLockTimeout = originalTimeout;
    }, additionalTime);
  }
}

// Singleton instance
let sessionInstance: SessionManager | null = null;

export function getSessionManager(config?: Partial<SessionConfig>): SessionManager {
  if (!sessionInstance) {
    sessionInstance = new SessionManager(config);
  }
  return sessionInstance;
}
