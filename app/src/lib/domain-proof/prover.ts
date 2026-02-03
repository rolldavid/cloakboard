/**
 * Domain Proof Prover
 *
 * Generates ZK proofs that verify a Google JWT RSA-2048 signature inside
 * a Noir circuit and extract the email domain. Adapted from the stealthnote
 * pattern using the noir-jwt library.
 *
 * The RSA signature is verified inside the circuit — no off-chain trust assumption.
 */

import { generateInputs } from 'noir-jwt';
import type { InputMap, CompiledCircuit } from '@noir-lang/noir_js';
import type { DomainProof, DomainProofPublicInputs } from '../auth/types';

const MAX_DOMAIN_LENGTH = 64;

/** Result of fetching Google's public key */
interface GooglePublicKeyResult {
  jwk: JsonWebKey;
  modulusBigInt: bigint;
}

/** Lazy-loaded prover modules */
let proverPromise: Promise<{
  Noir: typeof import('@noir-lang/noir_js').Noir;
  UltraHonkBackend: typeof import('@aztec/bb.js').UltraHonkBackend;
}> | null = null;

async function initProver() {
  if (!proverPromise) {
    proverPromise = (async () => {
      const [{ Noir }, { UltraHonkBackend }] = await Promise.all([
        import('@noir-lang/noir_js'),
        import('@aztec/bb.js'),
      ]);
      return { Noir, UltraHonkBackend };
    })();
  }
  return proverPromise;
}

/** Split a bigint into limbs for Noir circuit input */
function splitBigIntToLimbs(
  bigInt: bigint,
  byteLength: number,
  numLimbs: number
): bigint[] {
  const chunks: bigint[] = [];
  const mask = (1n << BigInt(byteLength)) - 1n;
  for (let i = 0; i < numLimbs; i++) {
    const chunk = (bigInt / (1n << (BigInt(i) * BigInt(byteLength)))) & mask;
    chunks.push(chunk);
  }
  return chunks;
}

/** Convert JWK modulus (base64url) to BigInt */
async function pubkeyModulusFromJWK(jwk: JsonWebKey): Promise<bigint> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify']
  );
  const exported = await crypto.subtle.exportKey('jwk', publicKey);
  // base64url decode the modulus
  const nBase64 = exported.n!.replace(/-/g, '+').replace(/_/g, '/');
  const nBytes = Uint8Array.from(atob(nBase64), c => c.charCodeAt(0));
  let result = 0n;
  for (const byte of nBytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

export class DomainProofProver {
  private circuitArtifact: CompiledCircuit | null = null;

  /**
   * Fetch Google's RSA public key by key ID from their JWKS endpoint
   */
  async fetchGooglePublicKey(keyId: string): Promise<GooglePublicKeyResult> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const keys = await response.json();
    const key = keys.keys.find((k: { kid: string }) => k.kid === keyId);
    if (!key) {
      throw new Error(`Google public key with id ${keyId} not found`);
    }
    const modulusBigInt = await pubkeyModulusFromJWK(key);
    return { jwk: key, modulusBigInt };
  }

  /**
   * Load the compiled circuit artifact (cached after first load)
   */
  private async loadCircuit(): Promise<CompiledCircuit> {
    if (!this.circuitArtifact) {
      this.circuitArtifact = (await import('../../assets/domain-proof/circuit.json')) as unknown as CompiledCircuit;
    }
    return this.circuitArtifact;
  }

  /**
   * Generate a domain verification proof
   *
   * Proves: "I have a valid Google JWT with email domain X"
   * without revealing the email address or any other JWT claims.
   */
  async generateProof(params: {
    idToken: string;
    domain: string;
    accountAddress: string;
    sub: string;
    onProgress?: (progress: number) => void;
  }): Promise<DomainProof> {
    const { idToken, domain, accountAddress, sub, onProgress } = params;
    const progress = onProgress ?? (() => {});

    progress(5);

    // 1. Parse JWT header to get key ID
    const [headerB64] = idToken.split('.');
    const header = JSON.parse(atob(headerB64));
    const keyId = header.kid;
    if (!keyId) {
      throw new Error('JWT header missing kid');
    }

    progress(10);

    // 2. Fetch Google's public key
    const { jwk: googlePubkey } = await this.fetchGooglePublicKey(keyId);

    progress(20);

    // 3. Generate noir-jwt inputs with partial SHA precomputation
    //    This splits the JWT so the circuit only processes from email/email_verified/sub onward
    const jwtInputs = await generateInputs({
      jwt: idToken,
      pubkey: googlePubkey,
      shaPrecomputeTillKeys: ['email', 'email_verified', 'sub'],
      maxSignedDataLength: 640,
    });

    progress(30);

    // 4. Prepare domain as padded byte array
    const domainUint8Array = new Uint8Array(MAX_DOMAIN_LENGTH);
    domainUint8Array.set(new TextEncoder().encode(domain));

    // 5. Prepare sub as padded byte array
    const subUint8Array = new Uint8Array(64);
    subUint8Array.set(new TextEncoder().encode(sub));

    // 6. Build circuit inputs
    const inputs = {
      partial_data: jwtInputs.partial_data,
      partial_hash: jwtInputs.partial_hash,
      full_data_length: jwtInputs.full_data_length,
      base64_decode_offset: jwtInputs.base64_decode_offset,
      jwt_pubkey_modulus_limbs: jwtInputs.pubkey_modulus_limbs,
      jwt_pubkey_redc_params_limbs: jwtInputs.redc_params_limbs,
      jwt_signature_limbs: jwtInputs.signature_limbs,
      sub_bytes: {
        storage: Array.from(subUint8Array),
        len: sub.length,
      },
      account_address: accountAddress,
      domain: {
        storage: Array.from(domainUint8Array),
        len: domain.length,
      },
      // nullifier and account_commitment are public outputs computed by the circuit
      // We pass the expected values for the circuit to verify
      nullifier: '0', // Will be computed by circuit
      account_commitment: '0', // Will be computed by circuit
    };

    progress(40);

    // 7. Load circuit and prover
    const [circuit, { Noir, UltraHonkBackend }] = await Promise.all([
      this.loadCircuit(),
      initProver(),
    ]);

    progress(50);

    const backend = new UltraHonkBackend(circuit.bytecode, { threads: navigator.hardwareConcurrency || 4 });
    const noir = new Noir(circuit);

    progress(60);

    // 8. Execute circuit (generate witness)
    const startTime = performance.now();
    const { witness } = await noir.execute(inputs as unknown as InputMap);

    progress(80);

    // 9. Generate proof
    const proof = await backend.generateProof(witness);
    const provingTime = performance.now() - startTime;

    progress(95);

    // 10. Extract public inputs from proof
    //     Public inputs order: jwt_pubkey_modulus_limbs(18) + domain(64+1 for BoundedVec) + nullifier(1) + account_commitment(1)
    const pubkeyLimbs = jwtInputs.pubkey_modulus_limbs as string[];

    // Compute domain hash for caching/lookup
    const domainHashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(domain.toLowerCase())
    );
    const domainHash = Array.from(new Uint8Array(domainHashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Extract nullifier and commitment from proof public inputs
    // These are the last 2 public inputs
    const nullifierHex = proof.publicInputs[proof.publicInputs.length - 2];
    const commitmentHex = proof.publicInputs[proof.publicInputs.length - 1];

    // Parse JWT expiry for proof expiration
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    const expiresAt = payload.exp ? payload.exp * 1000 : Date.now() + 3600000;

    const publicInputs: DomainProofPublicInputs = {
      domainHash,
      nullifier: nullifierHex,
      accountCommitment: commitmentHex,
      jwtPubkeyModulusLimbs: pubkeyLimbs,
    };

    progress(100);

    return {
      domain: domain.toLowerCase(),
      domainHash,
      nullifier: nullifierHex,
      accountCommitment: commitmentHex,
      proof: proof.proof,
      publicInputs,
      generatedAt: Date.now(),
      expiresAt,
    };
  }

  /**
   * Verify a proof locally using the verification key
   */
  async verifyProof(
    proof: Uint8Array,
    publicInputs: string[]
  ): Promise<boolean> {
    const { UltraHonkBackend } = await initProver();
    const circuit = await this.loadCircuit();
    const backend = new UltraHonkBackend(circuit.bytecode);
    return backend.verifyProof({ proof, publicInputs });
  }
}

// Singleton
let proverInstance: DomainProofProver | null = null;

export function getDomainProofProver(): DomainProofProver {
  if (!proverInstance) {
    proverInstance = new DomainProofProver();
  }
  return proverInstance;
}
