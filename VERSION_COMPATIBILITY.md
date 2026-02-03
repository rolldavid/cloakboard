# Version Compatibility Guide

This document outlines the version dependencies for Cloakboard and provides guidance for future updates.

## Current Version Matrix

| Component | Version | Notes |
|-----------|---------|-------|
| **Aztec Sandbox** | 3.0.0-devnet.6-patch.1 | Docker-based local node |
| **Aztec.js SDK** | 3.0.0-devnet.6-patch.1 | Frontend SDK (must match sandbox) |
| **Aztec Accounts** | 3.0.0-devnet.6-patch.1 | Account management (Schnorr, ECDSA) |
| **Aztec Foundation** | 3.0.0-devnet.6-patch.1 | Crypto primitives (Fr, GrumpkinScalar) |
| **Aztec Stdlib** | 3.0.0-devnet.6-patch.1 | Standard library and interfaces |
| **Aztec-nr** | v3.0.0-devnet.6-patch.1 | Noir contract libraries |
| **Nargo** | 1.0.0-beta.18 | Noir compiler |
| **Node.js** | 22.x | Runtime |
| **Next.js** | 14.2.0 | Frontend framework |

## SDK 3.x Architecture Changes

The SDK 3.x introduced significant architecture changes from previous versions:

### Import Paths (Subpath Exports)
SDK 3.x uses subpath exports instead of a single entry point:

```typescript
// OLD (SDK 0.x)
import { createPXEClient, Fr, AztecAddress, Wallet } from '@aztec/aztec.js';

// NEW (SDK 3.x)
import { createAztecNodeClient, waitForNode } from '@aztec/aztec.js/node';
import { AccountManager } from '@aztec/aztec.js/wallet';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
```

### Available Subpaths
- `@aztec/aztec.js/node` - Node client (createAztecNodeClient, waitForNode)
- `@aztec/aztec.js/wallet` - Wallet and AccountManager
- `@aztec/aztec.js/addresses` - AztecAddress, CompleteAddress
- `@aztec/aztec.js/fee` - Fee payment methods
- `@aztec/aztec.js/contracts` - Contract utilities
- `@aztec/aztec.js/deployment` - Contract deployment
- `@aztec/foundation/curves/bn254` - Fr field element
- `@aztec/foundation/curves/grumpkin` - GrumpkinScalar

### Key API Changes

| Old API | New API | Notes |
|---------|---------|-------|
| `createPXEClient()` | `createAztecNodeClient()` | Different interface |
| `getSchnorrAccount(pxe, ...)` | `AccountManager.create(wallet, ...)` | Static async method |
| `PXE` type | `AztecNode` type | Node interface |
| `NoFeePaymentMethod` | `SponsoredFeePaymentMethod` | Fee payment |
| `account.deploy().send().wait()` | `deployMethod.send({ from }).wait()` | Requires `from` |

### Account Creation Flow (SDK 3.x)

```typescript
import { AccountManager } from '@aztec/aztec.js/wallet';
import { SchnorrAccountContract } from '@aztec/accounts/schnorr';
import { Fr } from '@aztec/foundation/curves/bn254';
import { GrumpkinScalar } from '@aztec/foundation/curves/grumpkin';

// 1. Create account contract
const accountContract = new SchnorrAccountContract(signingKey);

// 2. Create account manager (requires a base wallet)
const accountManager = await AccountManager.create(
  baseWallet,
  secretKey,
  accountContract,
  salt
);

// 3. Get address (deterministic, no deployment needed)
const address = accountManager.address;

// 4. Get account for signing
const account = await accountManager.getAccount();

// 5. Deploy (optional, for on-chain operations)
const deployMethod = await accountManager.getDeployMethod();
await deployMethod.send({ from: AztecAddress.ZERO }).wait();
```

## Version Alignment Rules

### 1. Aztec Sandbox ↔ SDK
These MUST match exactly:
```json
// package.json
"@aztec/aztec.js": "3.0.0-devnet.6-patch.1",
"@aztec/accounts": "3.0.0-devnet.6-patch.1",
"@aztec/foundation": "3.0.0-devnet.6-patch.1",
"@aztec/stdlib": "3.0.0-devnet.6-patch.1"
```

### 2. Aztec Sandbox ↔ Aztec-nr
These MUST match exactly:
```toml
# contracts/Nargo.toml
[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-nr/", tag = "v3.0.0-devnet.6-patch.1", directory = "aztec" }
```

### 3. Nargo ↔ Aztec-nr
Use `noirup` to install the correct nargo version:
```bash
noirup  # Installs latest stable
# Or specific version:
noirup --version 1.0.0-beta.18
```

## Updating Versions

### Step 1: Update Sandbox
```bash
docker pull aztecprotocol/aztec:${NEW_VERSION}
# Or if using aztup:
aztup --version ${NEW_VERSION}
```

### Step 2: Update Aztec-nr Dependencies
Update `contracts/Nargo.toml`:
```toml
[dependencies]
aztec = { git = "https://github.com/AztecProtocol/aztec-nr/", tag = "v${NEW_VERSION}", directory = "aztec" }
uint_note = { git = "https://github.com/AztecProtocol/aztec-nr/", tag = "v${NEW_VERSION}", directory = "uint-note" }
compressed_string = { git = "https://github.com/AztecProtocol/aztec-nr/", tag = "v${NEW_VERSION}", directory = "compressed-string" }
```

### Step 3: Update Nargo
```bash
noirup  # For latest stable
```

### Step 4: Update SDK
```bash
cd app
yarn upgrade @aztec/aztec.js @aztec/accounts @aztec/foundation @aztec/stdlib
```

### Step 5: Check for API Changes
1. Review the [Aztec changelog](https://github.com/AztecProtocol/aztec-packages/releases)
2. Check for new subpath exports in package.json
3. Update import paths if needed

### Step 6: Recompile Contracts
```bash
cd contracts
nargo compile
```

### Step 7: Test
```bash
cd app
yarn build
yarn dev
```

## Common Issues & Solutions

### Import Assertions Error
**Symptom:** `SyntaxError: Unexpected identifier 'assert'` during build

**Solution:** Ensure Aztec SDK components are dynamically imported with `ssr: false`:
```typescript
const Component = dynamic(() => import('./Component'), { ssr: false });
```

### Module Not Found with Subpaths
**Symptom:** `Package path . is not exported from package @aztec/aztec.js`

**Solution:** SDK 3.x requires subpath imports. Update imports to use specific subpaths.

### Nargo Version Mismatch
**Symptom:** `Incompatible compiler version` error

**Solution:** Update nargo:
```bash
noirup  # Updates to latest stable
```

### Type Errors with AccountManager
**Symptom:** `Property 'X' does not exist on type 'AccountWithSecretKey'`

**Solution:** SDK 3.x returns `AccountWithSecretKey` from `accountManager.getAccount()`, not `Wallet`. Use flexible types or `any`.

### DeployMethod requires 'from'
**Symptom:** `Property 'from' is missing in type`

**Solution:** SDK 3.x requires `from` in deploy options:
```typescript
await deployMethod.send({
  from: AztecAddress.ZERO,
  fee: paymentMethod ? { paymentMethod } : undefined,
}).wait();
```

### PXE Connection Issues
**Symptom:** `Failed to connect to Aztec network`

**Solution:**
1. Ensure sandbox is running: `docker ps | grep aztec`
2. Check port 8080 is accessible
3. Verify `.env.local` has correct `NEXT_PUBLIC_AZTEC_NODE_URL`

## Monitoring Updates

### Aztec Discord
Join the [Aztec Discord](https://discord.gg/aztec) for announcements.

### GitHub Releases
Watch these repositories:
- https://github.com/AztecProtocol/aztec-packages/releases
- https://github.com/AztecProtocol/aztec-nr/releases

### Breaking Changes
Before updating, always check:
1. Release notes for breaking changes
2. Migration guides in the documentation
3. Test on a development branch first

## Package Lock Strategy

To ensure reproducible builds:
1. Commit `yarn.lock` to version control
2. Use exact versions in `package.json` for critical dependencies
3. Pin nargo version in CI/CD

## CI/CD Considerations

```yaml
# Example GitHub Actions workflow
jobs:
  build:
    steps:
      - uses: actions/checkout@v3
      - name: Install Noir
        run: |
          curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
          noirup --version 1.0.0-beta.18
      - name: Compile Contracts
        run: cd contracts && nargo compile
      - name: Build App
        run: cd app && yarn install && yarn build
```

## Emergency Rollback

If an update breaks the project:
1. Revert `Nargo.toml` to previous aztec-nr tag
2. Revert `package.json` SDK versions
3. Run `noirup --version <previous-version>`
4. Recompile and rebuild
