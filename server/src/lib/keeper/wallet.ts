/**
 * Keeper Wallet — Singleton server-side EmbeddedWallet for deploying contracts.
 *
 * Uses keeper's Schnorr keys from .env.local to sign transactions.
 * Follows the deployment plan: createSchnorrAccount → register on-chain instance.
 */

import { createAztecNodeClient, waitForNode, type AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { SponsoredFeePaymentMethod, type FeePaymentMethod } from '@aztec/aztec.js/fee';

type WalletLike = any;

let _node: AztecNode | null = null;
let _wallet: WalletLike | null = null;
let _keeperAddress: AztecAddress | null = null;
let _initPromise: Promise<void> | null = null;

function getNodeUrl(): string {
  return process.env.VITE_AZTEC_NODE_URL || 'https://rpc.testnet.aztec-labs.com/';
}

function getKeeperKeys() {
  const secretKey = process.env.KEEPER_SECRET_KEY;
  const signingKey = process.env.KEEPER_SIGNING_KEY;
  const salt = process.env.KEEPER_SALT;

  if (!secretKey || !signingKey || !salt) {
    throw new Error('Keeper keys not configured (KEEPER_SECRET_KEY, KEEPER_SIGNING_KEY, KEEPER_SALT)');
  }

  return { secretKey, signingKey, salt };
}

async function initializeKeeper(): Promise<void> {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const keys = getKeeperKeys();

  console.log(`[Keeper] Connecting to Aztec node... [${elapsed()}]`);
  _node = createAztecNodeClient(getNodeUrl());
  await waitForNode(_node);
  console.log(`[Keeper] Node connected [${elapsed()}]`);

  // Create EmbeddedWallet with native prover
  const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
  console.log(`[Keeper] Creating EmbeddedWallet... [${elapsed()}]`);
  _wallet = await EmbeddedWallet.create(_node as any, {
    ephemeral: true,
    pxeConfig: { proverEnabled: true },
  });
  console.log(`[Keeper] EmbeddedWallet created [${elapsed()}]`);

  // Use fromBufferReduce — raw bytes may exceed field modulus (per deployment plan)
  const secretFr = Fr.fromBufferReduce(Buffer.from(keys.secretKey.replace('0x', ''), 'hex'));
  const signingGs = GrumpkinScalar.fromBufferReduce(Buffer.from(keys.signingKey.replace('0x', ''), 'hex'));
  const saltFr = Fr.fromBufferReduce(Buffer.from(keys.salt.replace('0x', ''), 'hex'));

  // Import keeper's Schnorr account using wallet.createSchnorrAccount
  console.log(`[Keeper] Creating Schnorr account... [${elapsed()}]`);
  const accountManager = await _wallet.createSchnorrAccount(secretFr, saltFr, signingGs, 'keeper');
  _keeperAddress = accountManager.address;
  console.log(`[Keeper] Keeper address: ${_keeperAddress!.toString().slice(0, 14)}... [${elapsed()}]`);

  // Register keeper's on-chain contract instance with PXE
  const keeperInstance = await _node.getContract(_keeperAddress!);
  if (keeperInstance) {
    const accountContract = accountManager.getAccountContract();
    const keeperArtifact = await accountContract.getContractArtifact();
    await _wallet.registerContract(keeperInstance as any, keeperArtifact as any, secretFr);
    console.log(`[Keeper] On-chain instance registered with PXE [${elapsed()}]`);
  } else {
    console.warn(`[Keeper] WARNING: Keeper contract not found on-chain at ${_keeperAddress!.toString()}`);
  }

  // Register SponsoredFPC if available
  const fpcAddr = process.env.VITE_SPONSORED_FPC_ADDRESS;
  if (fpcAddr) {
    try {
      const { SponsoredFPCContract } = await import('@aztec/noir-contracts.js/SponsoredFPC');
      const fpcAddress = AztecAddress.fromString(fpcAddr);
      const fpcInstance = await _node.getContract(fpcAddress);
      if (fpcInstance) {
        await _wallet.registerContract(fpcInstance as any, SponsoredFPCContract.artifact as any);
        console.log(`[Keeper] SponsoredFPC registered [${elapsed()}]`);
      }
    } catch (err: any) {
      console.warn(`[Keeper] FPC registration failed (non-fatal): ${err?.message}`);
    }
  }

  console.log(`[Keeper] Initialization complete [${elapsed()}]`);
}

/**
 * Get the singleton keeper wallet. Initializes on first call.
 */
export async function getKeeperWallet(): Promise<WalletLike> {
  if (!_initPromise) {
    _initPromise = initializeKeeper().catch((err) => {
      _initPromise = null; // Allow retry on failure
      throw err;
    });
  }
  await _initPromise;
  return _wallet!;
}

/**
 * Get the Aztec node client (after wallet init).
 */
export async function getNode(): Promise<AztecNode> {
  await getKeeperWallet();
  return _node!;
}

/**
 * Get a SponsoredFeePaymentMethod if FPC is configured.
 */
export function getPaymentMethod(): FeePaymentMethod | undefined {
  const fpcAddr = process.env.VITE_SPONSORED_FPC_ADDRESS;
  if (fpcAddr) return new SponsoredFeePaymentMethod(AztecAddress.fromString(fpcAddr));
  return undefined;
}

/**
 * Get the keeper's AztecAddress.
 */
export function getKeeperAddress(): AztecAddress {
  if (_keeperAddress) return _keeperAddress;
  const addr = process.env.KEEPER_ADDRESS;
  if (!addr) throw new Error('KEEPER_ADDRESS not set');
  return AztecAddress.fromString(addr);
}
