import { createPXEClient, type AccountWallet, type PXE } from '@aztec/aztec.js';
import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { Fr, GrumpkinScalar } from '@aztec/aztec.js/fields';
import { getConfig } from '../config/config.js';

export async function getPXE(): Promise<PXE> {
  const config = getConfig();
  const nodeUrl = config.network.nodeUrl;

  console.log(`Connecting to Aztec PXE at: ${nodeUrl}`);

  const pxe = createPXEClient(nodeUrl);

  // Verify connection
  const nodeInfo = await pxe.getNodeInfo();
  console.log(`Connected to Aztec node version: ${nodeInfo.nodeVersion}`);

  return pxe;
}

export async function setupWallet(): Promise<AccountWallet> {
  const pxe = await getPXE();

  // In sandbox mode, use the first registered account (pre-funded)
  const accounts = await pxe.getRegisteredAccounts();

  if (accounts.length > 0) {
    console.log(`Using existing account: ${accounts[0].address.toString()}`);
    // Get wallet for existing account
    const { getSchnorrAccount } = await import('@aztec/accounts/schnorr');

    // For sandbox, we can create a new account and deploy it
    // The sandbox has special handling for initial deployments
  }

  // Create a new random account
  const secretKey = Fr.random();
  const signingKey = GrumpkinScalar.random();
  const salt = Fr.random();

  console.log('Creating deployment account...');

  const accountManager = getSchnorrAccount(pxe, secretKey, signingKey, salt);

  // Register the account
  const wallet = await accountManager.register();

  console.log(`Account registered: ${wallet.getAddress().toString()}`);

  return wallet;
}
