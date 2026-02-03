/**
 * ERC20 Proof Service
 *
 * Client-side ERC20 balance proof generation using the Noir circuit.
 * Follows the anoncast pattern for proving L1 token holdings.
 */

import { ERC20BalanceVerifier } from '@/lib/erc20-proof';
import type { ProofData, ChainConfig } from '@/lib/erc20-proof/verifier';

/** Cached proof entry */
interface CachedProof {
  proof: ProofData;
  expiresAt: number;
}

/** Proof cache TTL: 2 days (same as anoncast) */
const CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Service for generating and managing ERC20 balance proofs
 */
export class ERC20ProofService {
  private verifiers: Map<number, ERC20BalanceVerifier> = new Map();
  private proofCache: Map<string, CachedProof> = new Map();

  /**
   * Get or create a verifier for a specific chain
   */
  private getVerifier(chainId: number, rpcUrl: string): ERC20BalanceVerifier {
    let verifier = this.verifiers.get(chainId);
    if (!verifier) {
      verifier = new ERC20BalanceVerifier({ chainId, rpcUrl });
      this.verifiers.set(chainId, verifier);
    }
    return verifier;
  }

  /**
   * Build proof input by fetching Ethereum storage proof
   */
  async buildProofInput(params: {
    ethAddress: string;
    tokenAddress: string;
    chainId: number;
    rpcUrl: string;
    balanceSlot: number;
    minBalance: bigint;
  }) {
    const verifier = this.getVerifier(params.chainId, params.rpcUrl);
    return verifier.buildInput({
      address: params.ethAddress,
      tokenAddress: params.tokenAddress,
      balanceSlot: params.balanceSlot,
      verifiedBalance: params.minBalance,
    });
  }

  /**
   * Generate a ZK proof in the browser (Barretenberg WASM)
   */
  async generateProof(params: {
    chainId: number;
    rpcUrl: string;
    circuitInputs: Record<string, unknown>;
    signature: string;
    messageHash: string;
  }): Promise<ProofData> {
    const verifier = this.getVerifier(params.chainId, params.rpcUrl);
    return verifier.generateProof({
      circuitInputs: params.circuitInputs,
      signature: params.signature,
      messageHash: params.messageHash,
    });
  }

  /**
   * Verify a proof locally
   */
  async verifyProof(params: {
    chainId: number;
    rpcUrl: string;
    proof: ProofData;
  }): Promise<boolean> {
    const verifier = this.getVerifier(params.chainId, params.rpcUrl);
    return verifier.verifyProof(params.proof);
  }

  /**
   * Cache a proof for reuse (2-day expiry)
   */
  cacheProof(cloakAddress: string, proof: ProofData): void {
    this.proofCache.set(cloakAddress, {
      proof,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  /**
   * Get a cached proof if it hasn't expired
   */
  getCachedProof(cloakAddress: string): ProofData | null {
    const cached = this.proofCache.get(cloakAddress);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      this.proofCache.delete(cloakAddress);
      return null;
    }
    return cached.proof;
  }

  /**
   * Clear all cached proofs
   */
  clearCache(): void {
    this.proofCache.clear();
  }
}

/** Singleton instance */
let instance: ERC20ProofService | null = null;

export function getERC20ProofService(): ERC20ProofService {
  if (!instance) {
    instance = new ERC20ProofService();
  }
  return instance;
}
