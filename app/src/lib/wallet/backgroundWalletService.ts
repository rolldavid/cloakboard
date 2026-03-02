/**
 * Background Wallet Service
 *
 * After a user authenticates, this service creates their Aztec wallet
 * in the background. The user sees the app immediately while wallet
 * creation happens silently.
 *
 * Flow: authenticate → store keys → initialize Aztec client → import account → deploy
 *       → store username on UserProfile (background tx)
 */

import type { DerivedKeys, AuthMethod } from '@/types/wallet';
import { createAztecClient, type AztecConfig } from '@/lib/aztec/client';
import { AztecAddress } from '@aztec/aztec.js/addresses';

interface PendingWallet {
  keys: DerivedKeys;
  method: AuthMethod;
  username?: string;
}

// Module-level state for pending wallet creation
let _pending: PendingWallet | null = null;
let _creationPromise: Promise<string | null> | null = null;
let _deployPromise: Promise<void> | null = null;
let _deployResolved = false;

/**
 * Queue wallet creation for background processing.
 * Call this immediately after authentication.
 * If creation is already in progress, returns the existing promise.
 */
export function queueWalletCreation(keys: DerivedKeys, method: AuthMethod, username?: string): void {
  if (_creationPromise) return; // Already in progress or done

  _pending = {
    keys,
    method,
    username,
  };
  // Start creation immediately (fire-and-forget)
  _creationPromise = createWalletInBackground().catch((err) => {
    console.error('[BackgroundWallet] Creation failed:', err?.message);
    return null;
  });
}

/**
 * Wait for the background wallet creation to complete.
 * Returns the Aztec address string or null if failed.
 */
export async function waitForWalletCreation(): Promise<string | null> {
  if (_creationPromise) return _creationPromise;
  return null;
}

/**
 * Check if wallet creation is pending or in progress.
 */
export function isWalletCreationPending(): boolean {
  return _pending !== null;
}

/**
 * Wait for account deployment to complete.
 * Returns immediately if already deployed or no deploy in progress.
 */
export async function waitForAccountDeploy(): Promise<void> {
  if (_deployResolved) return;
  if (_deployPromise) return _deployPromise;
}

/**
 * Check if account deployment has completed.
 * If deploy confirmation timed out earlier, re-checks on-chain.
 */
export function isAccountDeployed(): boolean {
  return _deployResolved;
}

/**
 * Re-check on-chain whether the account is deployed.
 * Useful when the initial confirmation timed out but the deploy may have since mined.
 */
export async function recheckAccountDeployed(): Promise<boolean> {
  if (_deployResolved) return true;

  try {
    const { getAztecClient } = await import('@/lib/aztec/client');
    const client = getAztecClient();
    if (!client) return false;
    const address = client.getAddress();
    if (!address) return false;
    const confirmed = await client.isAccountDeployed(address);
    if (confirmed) _deployResolved = true;
    return confirmed;
  } catch {
    return false;
  }
}

/**
 * Reset wallet creation state. Call on logout to ensure
 * a fresh start when logging in with a different account.
 */
export function resetWalletCreation(): void {
  _pending = null;
  _creationPromise = null;
  _deployPromise = null;
  _deployResolved = false;
}

async function createWalletInBackground(): Promise<string | null> {
  if (!_pending) return null;
  const { keys, username } = _pending;

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    console.log(`[BackgroundWallet] Starting wallet creation... [${elapsed()}]`);

    // 1. Initialize Aztec client
    const nodeUrl = (import.meta as any).env?.VITE_AZTEC_NODE_URL || 'https://v4-devnet-2.aztec-labs.com';
    const sponsoredFpcAddress = (import.meta as any).env?.VITE_SPONSORED_FPC_ADDRESS;
    const environment = ((import.meta as any).env?.VITE_DEFAULT_NETWORK || 'devnet') as AztecConfig['environment'];

    const config: AztecConfig = { nodeUrl, environment, sponsoredFpcAddress };
    const client = await createAztecClient(config);
    console.log(`[BackgroundWallet] Aztec client initialized [${elapsed()}]`);

    // 2. Import account from derived keys
    const { address } = await client.importAccountFromDerivedKeys(keys);
    const addressStr = address.toString();
    console.log(`[BackgroundWallet] Account imported: ${addressStr.slice(0, 14)}... [${elapsed()}]`);

    // 3. Deploy account from browser (SponsoredFPC pays gas) — fire-and-forget, but track completion
    //    Wait for on-chain deploy confirmation before marking as deployed,
    //    otherwise voting can fail (account entrypoint not available on-chain).
    _deployPromise = client.deployAccount()
      .then(async (addr) => {
        console.log(`[BackgroundWallet] Deploy tx sent: ${addr.toString().slice(0, 14)}... [${elapsed()}]`);
        const confirmed = await client.waitForDeployConfirmation(
          AztecAddress.fromString(addr.toString()),
          60, // 60 attempts × 3s = 180s
        );
        if (confirmed) {
          _deployResolved = true;
          console.log(`[BackgroundWallet] Constructor confirmed on-chain [${elapsed()}]`);
        } else {
          console.warn(`[BackgroundWallet] Constructor confirmation timed out [${elapsed()}]`);
        }
      })
      .catch((deployErr: any) => {
        // "Already deployed" counts as success — constructor already ran
        if (deployErr?.message?.includes('alreadyDeployed') || deployErr?.message?.includes('Already deployed')) {
          _deployResolved = true;
        }
        console.warn(`[BackgroundWallet] Deploy failed (non-fatal): ${deployErr?.message}`);
      });

    // 4. Store username on UserProfile contract (background tx, fire-and-forget)
    if (username) {
      storeUsernameOnChain(client, username).catch((err: any) =>
        console.warn(`[BackgroundWallet] Username store failed (non-fatal): ${err?.message}`),
      );
    }

    _pending = null;
    return addressStr;
  } catch (err: any) {
    console.error(`[BackgroundWallet] Error [${elapsed()}]:`, err?.message);
    _pending = null;
    return null;
  }
}

/**
 * Store username on-chain via UserProfile contract.
 * Background tx — does not block wallet creation or voting.
 */
async function storeUsernameOnChain(client: any, username: string): Promise<void> {
  const profileAddress = (import.meta as any).env?.VITE_USER_PROFILE_ADDRESS;
  if (!profileAddress) {
    console.log('[BackgroundWallet] No VITE_USER_PROFILE_ADDRESS — skipping username store');
    return;
  }

  // Wait for account deploy + constructor confirmation before sending username tx
  if (_deployPromise) await _deployPromise.catch(() => {});

  const { getUserProfileArtifact } = await import('@/lib/aztec/contracts');
  const { UserProfileService } = await import('@/lib/aztec/UserProfileService');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');

  const wallet = client.getWallet();
  const senderAddress = client.getAddress() ?? undefined;
  const paymentMethod = client.getPaymentMethod();
  const artifact = await getUserProfileArtifact();
  const addr = AztecAddress.fromString(profileAddress);

  // Register contract with PXE (retry up to 3 times — node may not have indexed it yet)
  const node = client.getNode();
  if (node) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const instance = await node.getContract(addr);
        if (instance) {
          await wallet.registerContract(instance, artifact);
          break;
        }
      } catch { /* may already be registered */ }
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }

  const svc = new UserProfileService(wallet, senderAddress, paymentMethod);
  await svc.connect(addr, artifact);
  await svc.setUsername(username);
  console.log(`[BackgroundWallet] Username "${username}" stored on-chain`);
}
