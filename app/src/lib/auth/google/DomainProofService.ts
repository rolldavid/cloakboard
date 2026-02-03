/**
 * Domain Proof Service
 *
 * Manages ZK domain proof generation and caching.
 * Proofs are generated in a Web Worker to avoid blocking the UI.
 *
 * Flow:
 * 1. OAuth login completes → instant wallet creation
 * 2. Background: Web Worker generates domain proof
 * 3. Proof cached in IndexedDB
 * 4. When joining gated Cloak: use cached proof (instant) or generate new
 */

import { openDB, IDBPDatabase } from 'idb';
import type {
  DomainProof,
  CachedProof,
  ProofState,
  ProofWorkerRequest,
  ProofWorkerResponse,
} from '../types';
import { DomainProofProver } from '../../domain-proof/prover';

const DB_NAME = 'private-cloak-proofs';
const DB_VERSION = 1;
const STORE_NAME = 'domain-proofs';

type ProofStateListener = (state: ProofState) => void;

export class DomainProofService {
  private db: IDBPDatabase | null = null;
  private worker: Worker | null = null;
  private initialized: boolean = false;
  private prover: DomainProofProver = new DomainProofProver();
  private currentState: ProofState = { status: 'idle' };
  private listeners: Set<ProofStateListener> = new Set();

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize IndexedDB
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'domain' });
        }
      },
    });

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('DomainProofService not initialized. Call initialize() first.');
    }
  }

  /**
   * Get current proof generation state
   */
  getState(): ProofState {
    return this.currentState;
  }

  /**
   * Subscribe to proof state changes
   */
  subscribe(listener: ProofStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get cached proof for a domain
   */
  async getCachedProof(domain: string): Promise<DomainProof | null> {
    await this.initialize();
    this.ensureInitialized();

    const cached = await this.db!.get(STORE_NAME, domain.toLowerCase()) as CachedProof | undefined;
    if (!cached) return null;

    // Check if proof has expired
    if (cached.expiresAt < Date.now()) {
      await this.deleteCachedProof(domain);
      return null;
    }

    return {
      domain: cached.domain,
      domainHash: cached.publicInputs.domainHash,
      nullifier: cached.publicInputs.nullifier,
      accountCommitment: cached.publicInputs.accountCommitment,
      proof: cached.proof,
      publicInputs: cached.publicInputs,
      generatedAt: cached.generatedAt,
      expiresAt: cached.expiresAt,
    };
  }

  /**
   * Check if we have a valid cached proof for a domain
   */
  async hasValidProof(domain: string): Promise<boolean> {
    const proof = await this.getCachedProof(domain);
    return proof !== null;
  }

  /**
   * Generate domain proof in background
   * Returns immediately, proof generation happens in Web Worker
   */
  generateProofInBackground(
    idToken: string,
    domain: string,
    accountAddress: string
  ): void {
    this.updateState({ status: 'generating', progress: 0 });

    // Create Web Worker
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(
          new URL('../workers/proof-worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (event: MessageEvent<ProofWorkerResponse>) => {
          this.handleWorkerMessage(event.data);
        };

        this.worker.onerror = (error) => {
          console.error('Proof worker error:', error);
          this.updateState({ status: 'error', error: 'Worker error' });
          this.cleanupWorker();
        };

        // Send request to worker
        const request: ProofWorkerRequest = {
          type: 'generate-domain-proof',
          idToken,
          domain,
          accountAddress,
        };
        this.worker.postMessage(request);
      } catch (error) {
        console.error('Failed to create proof worker:', error);
        this.updateState({ status: 'error', error: 'Failed to start proof generation' });
      }
    } else {
      // Web Workers not supported, generate synchronously
      this.generateProofSync(idToken, domain, accountAddress);
    }
  }

  /**
   * Generate proof synchronously (fallback when Workers unavailable)
   */
  private async generateProofSync(
    idToken: string,
    domain: string,
    accountAddress: string
  ): Promise<void> {
    try {
      const proof = await this.generateProofDirect(idToken, domain, accountAddress);
      await this.cacheProof(proof);
      this.updateState({ status: 'ready', proof });
    } catch (error) {
      this.updateState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Proof generation failed',
      });
    }
  }

  /**
   * Generate proof directly (without worker)
   */
  async generateProofDirect(
    idToken: string,
    domain: string,
    accountAddress: string
  ): Promise<DomainProof> {
    // Parse JWT for sub (needed for nullifier)
    const parts = idToken.split('.');
    let sub = '';
    try {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.sub) sub = payload.sub;
    } catch {
      // Use default
    }

    return this.prover.generateProof({
      idToken,
      domain,
      accountAddress,
      sub,
    });
  }

  /**
   * Generate and wait for proof (blocking)
   */
  async generateProofAndWait(
    idToken: string,
    domain: string,
    accountAddress: string
  ): Promise<DomainProof> {
    // Check cache first
    const cached = await this.getCachedProof(domain);
    if (cached) return cached;

    // Generate new proof
    const proof = await this.generateProofDirect(idToken, domain, accountAddress);
    await this.cacheProof(proof);
    return proof;
  }

  /**
   * Handle messages from the Web Worker
   */
  private async handleWorkerMessage(response: ProofWorkerResponse): Promise<void> {
    switch (response.type) {
      case 'proof-progress':
        this.updateState({ status: 'generating', progress: response.progress });
        break;

      case 'proof-ready':
        if (response.proof) {
          await this.cacheProof(response.proof);
          this.updateState({ status: 'ready', proof: response.proof });
        }
        this.cleanupWorker();
        break;

      case 'proof-error':
        this.updateState({ status: 'error', error: response.error });
        this.cleanupWorker();
        break;
    }
  }

  /**
   * Cache a proof in IndexedDB
   */
  private async cacheProof(proof: DomainProof): Promise<void> {
    await this.initialize();
    this.ensureInitialized();

    const cached: CachedProof = {
      domain: proof.domain.toLowerCase(),
      proof: proof.proof,
      publicInputs: proof.publicInputs,
      generatedAt: proof.generatedAt,
      expiresAt: proof.expiresAt,
    };

    await this.db!.put(STORE_NAME, cached);
  }

  /**
   * Delete cached proof for a domain
   */
  async deleteCachedProof(domain: string): Promise<void> {
    await this.initialize();
    this.ensureInitialized();

    await this.db!.delete(STORE_NAME, domain.toLowerCase());
  }

  /**
   * Clear all cached proofs
   */
  async clearAllProofs(): Promise<void> {
    await this.initialize();
    this.ensureInitialized();

    await this.db!.clear(STORE_NAME);
  }

  /**
   * List all cached domains
   */
  async listCachedDomains(): Promise<string[]> {
    await this.initialize();
    this.ensureInitialized();

    const keys = await this.db!.getAllKeys(STORE_NAME);
    return keys as string[];
  }

  /**
   * Hash a string using SHA-256
   */
  private async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Update state and notify listeners
   */
  private updateState(state: ProofState): void {
    this.currentState = state;
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('Error in proof state listener:', error);
      }
    });
  }

  /**
   * Clean up Web Worker
   */
  private cleanupWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Dispose of the service
   */
  dispose(): void {
    this.cleanupWorker();
    this.listeners.clear();
  }
}

// Singleton instance
let domainProofServiceInstance: DomainProofService | null = null;

export function getDomainProofService(): DomainProofService {
  if (!domainProofServiceInstance) {
    domainProofServiceInstance = new DomainProofService();
  }
  return domainProofServiceInstance;
}
