/**
 * Proof Worker
 *
 * Web Worker for generating ZK domain proofs in the background.
 * Uses noir-jwt to verify the Google JWT RSA-2048 signature inside
 * a Noir circuit — no off-chain trust assumption.
 *
 * Flow:
 * 1. Main thread sends id_token, domain, accountAddress
 * 2. Worker uses DomainProofProver (noir-jwt) to generate real ZK proof
 * 3. Worker posts back proof when ready
 * 4. Main thread caches proof in IndexedDB
 */

import type { ProofWorkerRequest, ProofWorkerResponse } from '../types';
import { DomainProofProver } from '../../domain-proof/prover';

// Type assertion for worker context
const workerContext = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ProofWorkerRequest>) => void) | null;
  postMessage: (message: ProofWorkerResponse) => void;
};

const prover = new DomainProofProver();

/**
 * Handle incoming messages from main thread
 */
workerContext.onmessage = async (event: MessageEvent<ProofWorkerRequest>) => {
  const { type, idToken, domain, accountAddress } = event.data;

  if (type === 'generate-domain-proof') {
    try {
      // Parse JWT to extract sub for nullifier
      const parts = idToken.split('.');
      const payload = JSON.parse(atob(parts[1]));
      const sub = payload.sub || '';

      const proof = await prover.generateProof({
        idToken,
        domain,
        accountAddress,
        sub,
        onProgress: (progress) => {
          workerContext.postMessage({
            type: 'proof-progress',
            progress,
          });
        },
      });

      workerContext.postMessage({
        type: 'proof-ready',
        proof,
      });
    } catch (error) {
      workerContext.postMessage({
        type: 'proof-error',
        error: error instanceof Error ? error.message : 'Failed to generate proof',
      });
    }
  }
};

// Export empty object for TypeScript module resolution
export {};
