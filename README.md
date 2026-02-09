# Cloakboard

Create and govern private decentralized organizations on Aztec Network. Deploy governance contracts with private voting, private membership, and zero-knowledge proofs.

## Features

- **Private Voting** — Cast votes without revealing your identity using ZK proofs
- **Private Membership** — Member lists and voting power are hidden on-chain
- **Governor Bravo** — Full OZ-style governance with ERC20Votes delegation, timelocks, and quorum
- **Multi-Auth Accounts** — Log in with Google, email magic link, passkey, or Ethereum/Solana wallet
- **Token Gating** — Gate membership by Aztec token balance or ERC20 holdings

## Project Structure

```
private-dao/
├── app/                    # Next.js frontend + API
│   └── src/
│       ├── app/            # Pages and API routes
│       ├── components/     # React components
│       ├── lib/            # Aztec SDK integration, services, hooks
│       └── store/          # Zustand state management
├── contracts/              # Aztec.nr smart contracts
│   ├── private_cloak/      # Base private decentralized organization contract
│   ├── governor_bravo/     # Governor Bravo governance contract
│   ├── cloak_registry/     # On-chain name registry
│   ├── multi_auth_account/ # Multi-auth account contract
│   ├── starred_cloaks/     # Starred cloaks contract
│   ├── scripts/            # Deployment scripts
│   └── target/             # Compiled contract artifacts
└── config/                 # Network configurations (devnet, testnet, mainnet)
```

Pre-compiled contract artifacts are included in `app/src/lib/aztec/artifacts/*.json` so you can run the app without setting up the Noir toolchain.

## Prerequisites

- Node.js >= 18
- [Aztec CLI](https://docs.aztec.network/developers/getting_started) (for local development or recompiling contracts)

```bash
bash -i <(curl -s https://install.aztec.network)
export VERSION=3.0.0-devnet.6-patch.1
aztec-up
```

## Quick Start

### 1. Install Dependencies

```bash
cd app && npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` for your target network. For devnet:

```env
NEXT_PUBLIC_DEFAULT_NETWORK=devnet
NEXT_PUBLIC_AZTEC_NODE_URL=https://devnet-6.aztec-labs.com/
NEXT_PUBLIC_SPONSORED_FPC_ADDRESS=0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e
```

### 3. Run the App

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 4. (Optional) Local Aztec Sandbox

To run against a local network instead of devnet:

```bash
# Start local Aztec sandbox (separate terminal)
aztec start --local-network

# Update .env.local
NEXT_PUBLIC_DEFAULT_NETWORK=sandbox
NEXT_PUBLIC_AZTEC_NODE_URL=http://localhost:8080
```

## Recompiling Contracts

Only needed if you modify the Noir contract source:

```bash
cd contracts
npm install
nargo compile
```

Then copy the updated JSON artifacts from `contracts/target/` into `app/src/lib/aztec/artifacts/`.

## Deployment

The app is a standard Next.js server application. Railway is recommended for deployment since the Aztec WASM packages require a persistent Node.js server (not serverless).

1. Connect your repo to [Railway](https://railway.com)
2. Set root directory to `app`
3. Add environment variables from `.env.example`
4. Railway auto-detects Next.js and runs `npm run build` / `npm run start`

## Smart Contracts

### Private Cloak

Base private decentralized organization contract with private membership and voting. Members are added with voting power stored in private notes. Votes use nullifiers to prevent double-voting without revealing voter identity.

### Governor Bravo

Full governance contract following the OZ Governor Bravo pattern. Includes ERC20Votes-style delegation, proposal thresholds, quorum requirements, and timelocks.

### Cloak Registry

On-chain name registry ensuring unique cloak names across the network.

### Multi-Auth Account

Account contract supporting multiple authentication methods (Schnorr keys, ECDSA, passkeys) so users can log in via Google, email, passkey, or wallet.


## License

[MIT](LICENSE)
