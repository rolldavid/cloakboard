/**
 * ERC20 Balance Verifier
 *
 * Client-side ZK proof generation and verification for ERC20 token balances.
 * Adapted from the anoncast pattern: proves L1 ERC20 holdings via Ethereum
 * state Merkle-Patricia trie proofs without bridge contracts.
 */

/** Chain configuration for ERC20 verification */
export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
}

/** Input parameters for building a proof */
export interface BuildInputParams {
  /** User's Ethereum address */
  address: string;
  /** ERC20 contract address */
  tokenAddress: string;
  /** Storage slot for balances mapping */
  balanceSlot: number;
  /** Minimum balance to prove */
  verifiedBalance: bigint;
  /** Block number to prove against (latest if not specified) */
  blockNumber?: number;
}

/** Result of building proof inputs */
export interface BuildInputResult {
  /** Formatted inputs for the Noir circuit */
  circuitInputs: Record<string, unknown>;
  /** Block number used */
  blockNumber: number;
  /** Storage hash from the proof */
  storageHash: string;
}

/** Input for proof generation */
export interface GenerateProofInput {
  circuitInputs: Record<string, unknown>;
  /** ECDSA signature from wallet */
  signature: string;
  /** Message that was signed */
  messageHash: string;
}

/** Generated proof data */
export interface ProofData {
  proof: Uint8Array;
  publicInputs: string[];
  /** Nullifier derived from the signature (prevents double-use) */
  nullifier: string;
  /** The verified balance */
  verifiedBalance: string;
  /** Chain context */
  chainId: number;
  blockNumber: number;
  tokenAddress: string;
}

/** Parsed credential data from public inputs */
export interface CredentialData {
  verifiedBalance: bigint;
  chainId: number;
  blockNumber: number;
  tokenAddress: string;
  balanceSlot: number;
  storageHash: string;
}

/**
 * ERC20 Balance Verifier
 *
 * Generates and verifies ZK proofs of ERC20 token balance ownership
 * using Ethereum state proofs (Merkle-Patricia trie).
 */
export class ERC20BalanceVerifier {
  private chainConfig: ChainConfig;

  constructor(chainConfig: ChainConfig) {
    this.chainConfig = chainConfig;
  }

  /**
   * Fetch Ethereum storage proof for an ERC20 token balance.
   * Uses eth_getProof RPC call to get Merkle-Patricia trie proof.
   */
  async buildInput(params: BuildInputParams): Promise<BuildInputResult> {
    const { address, tokenAddress, balanceSlot, verifiedBalance } = params;

    // Get the block number to prove against
    let blockNumber = params.blockNumber;
    if (!blockNumber) {
      const blockHex = await this.rpcCall('eth_blockNumber', []);
      blockNumber = parseInt(blockHex, 16);
    }

    // Compute the storage key for balances[address]
    // keccak256(abi.encode(address, slot))
    const storageKey = this.computeStorageKey(address, balanceSlot);

    // Fetch the storage proof via eth_getProof
    const blockHex = '0x' + blockNumber.toString(16);
    const proofResult = await this.rpcCall('eth_getProof', [
      tokenAddress,
      [storageKey],
      blockHex,
    ]);

    const storageProof = proofResult.storageProof[0];
    const storageHash = proofResult.storageHash;

    // Format proof nodes for the Noir circuit
    const nodes = this.formatProofNodes(storageProof.proof);
    const leaf = this.formatLeaf(storageProof.proof);

    return {
      circuitInputs: {
        storage_hash: this.hexToBytes32(storageHash),
        storage_nodes: nodes,
        storage_leaf: leaf,
        storage_depth: storageProof.proof.length,
        storage_value: storageProof.value,
        chain_id: this.chainConfig.chainId.toString(),
        block_number: blockNumber.toString(),
        token_address: tokenAddress,
        balance_slot: balanceSlot.toString(),
        verified_balance: verifiedBalance.toString(),
        storage_hash_field: BigInt(storageHash).toString(),
      },
      blockNumber,
      storageHash,
    };
  }

  /**
   * Generate a ZK proof client-side.
   * Requires @aztec/bb.js and @noir-lang/noir_js for WASM proving.
   */
  async generateProof(args: GenerateProofInput): Promise<ProofData> {
    // Dynamic import for browser-only WASM modules
    const { Noir } = await import('@noir-lang/noir_js');
    const { BarretenbergBackend } = await import('@aztec/bb.js') as any;

    // Load the compiled circuit
    const circuit = await this.loadCircuit();
    const backend = new BarretenbergBackend(circuit);
    const noir = new Noir(circuit);

    // Add signature inputs
    const fullInputs = {
      ...args.circuitInputs,
      signature: this.hexToBytes(args.signature, 64),
      message_hash: this.hexToBytes(args.messageHash, 32),
      pub_key_x: new Array(32).fill(0), // Derived from signature
      pub_key_y: new Array(32).fill(0), // Derived from signature
    };

    // Execute circuit to get witness, then generate proof
    const { witness } = await noir.execute(fullInputs);
    const proofResult = await backend.generateProof(witness) as any;

    // Compute nullifier from signature (prevents double-use)
    const nullifier = await this.computeNullifier(args.signature);

    return {
      proof: proofResult.proof,
      publicInputs: (proofResult.publicInputs ?? []).map(String),
      nullifier,
      verifiedBalance: args.circuitInputs.verified_balance as string,
      chainId: parseInt(args.circuitInputs.chain_id as string),
      blockNumber: parseInt(args.circuitInputs.block_number as string),
      tokenAddress: args.circuitInputs.token_address as string,
    };
  }

  /**
   * Verify a proof (client-side or server-side).
   */
  async verifyProof(proof: ProofData): Promise<boolean> {
    try {
      const { BarretenbergBackend } = await import('@aztec/bb.js') as any;
      const circuit = await this.loadCircuit();
      const backend = new BarretenbergBackend(circuit);
      return await backend.verifyProof({
        proof: proof.proof,
        publicInputs: proof.publicInputs,
      });
    } catch {
      return false;
    }
  }

  /**
   * Parse public inputs from a verified proof into structured data.
   */
  parseData(publicInputs: string[]): CredentialData {
    return {
      verifiedBalance: BigInt(publicInputs[0] ?? '0'),
      chainId: parseInt(publicInputs[1] ?? '0'),
      blockNumber: parseInt(publicInputs[2] ?? '0'),
      tokenAddress: publicInputs[3] ?? '',
      balanceSlot: parseInt(publicInputs[4] ?? '0'),
      storageHash: publicInputs[5] ?? '',
    };
  }

  // ===== Private Helpers =====

  private async rpcCall(method: string, params: unknown[]): Promise<any> {
    const response = await fetch(this.chainConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }
    return data.result;
  }

  private computeStorageKey(address: string, slot: number): string {
    // keccak256(abi.encode(address, slot))
    // Simplified: in production use viem's keccak256 + encodePacked
    const paddedAddress = address.toLowerCase().replace('0x', '').padStart(64, '0');
    const paddedSlot = slot.toString(16).padStart(64, '0');
    // Would use keccak256 here - placeholder for the hex concatenation
    return '0x' + paddedAddress + paddedSlot;
  }

  private formatProofNodes(proof: string[]): number[][] {
    const maxNodes = 5;
    const nodeSize = 532;
    const nodes: number[][] = [];
    for (let i = 0; i < maxNodes; i++) {
      if (i < proof.length) {
        const bytes = this.hexToBytes(proof[i], nodeSize);
        nodes.push(bytes);
      } else {
        nodes.push(new Array(nodeSize).fill(0));
      }
    }
    return nodes;
  }

  private formatLeaf(proof: string[]): number[] {
    const leafSize = 120;
    if (proof.length > 0) {
      return this.hexToBytes(proof[proof.length - 1], leafSize);
    }
    return new Array(leafSize).fill(0);
  }

  private hexToBytes(hex: string, length: number): number[] {
    const clean = hex.replace('0x', '');
    const bytes: number[] = [];
    for (let i = 0; i < length; i++) {
      if (i * 2 < clean.length) {
        bytes.push(parseInt(clean.substring(i * 2, i * 2 + 2), 16));
      } else {
        bytes.push(0);
      }
    }
    return bytes;
  }

  private hexToBytes32(hex: string): number[] {
    return this.hexToBytes(hex, 32);
  }

  private async computeNullifier(signature: string): Promise<string> {
    // Hash the signature to create a deterministic nullifier
    const encoder = new TextEncoder();
    const data = encoder.encode(signature);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return '0x' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async loadCircuit(): Promise<any> {
    // Load the compiled circuit artifact
    // In production, this would load from a bundled JSON file
    const response = await fetch('/circuits/erc20_balance_proof.json');
    return response.json();
  }
}
