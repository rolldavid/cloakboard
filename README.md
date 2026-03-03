# Cloakboard

Privacy-preserving voting platform on Aztec. Users vote on binary, multi-item, and level duels with cryptographic privacy guarantees — voter identity is never linked to vote direction on-chain or off-chain.

## Project Structure

```
duelcloak/
├── app/                          # Vite + React + TypeScript frontend
│   ├── src/
│   │   ├── pages/                # Route pages
│   │   │   ├── HomePage.tsx              # Feed with category bar, sort tabs, trending sidebar
│   │   │   ├── CategoryPage.tsx          # Category-filtered duel feed
│   │   │   ├── DuelDetailPage.tsx        # Single duel view, voting, chart, comments
│   │   │   ├── CreateDuelPage.tsx        # Duel creation wizard
│   │   │   ├── SearchResultsPage.tsx     # Full-text search results
│   │   │   ├── UserProfilePage.tsx       # User stats, whisper points, settings
│   │   │   └── GoogleCallback.tsx        # OAuth redirect handler
│   │   │
│   │   ├── components/
│   │   │   ├── auth/                     # Auth method buttons (Google, ETH, Solana, Passkey)
│   │   │   ├── duel/                     # DuelCard, VoteChart, MultiItemVote, LevelVote
│   │   │   ├── feed/                     # TrendingSidebar
│   │   │   ├── nav/                      # CategoryBar, SubcategorySidebar, SearchBar
│   │   │   ├── ui/                       # Logo, theme toggle, loading states
│   │   │   ├── VoteCloakingModal.tsx     # 3-phase vote overlay (cloaking -> points -> confirmed)
│   │   │   └── DuelCreationModal.tsx     # Quick-create modal
│   │   │
│   │   ├── lib/
│   │   │   ├── api/                      # API client (all server calls via VITE_API_URL)
│   │   │   ├── auth/                     # Auth method implementations
│   │   │   │   ├── ethereum/                 # MetaMask key derivation + signing
│   │   │   │   ├── google/                   # Google OAuth + key derivation
│   │   │   │   ├── solana/                   # Phantom key derivation + signing
│   │   │   │   ├── passkey/                  # WebAuthn credential-based key derivation
│   │   │   │   ├── linkResolver.ts           # Cross-device account linking resolution
│   │   │   │   └── vaultEncryption.ts        # AES-256-GCM vault for LinkRegistry
│   │   │   ├── aztec/                    # Aztec L2 integration
│   │   │   │   ├── client.ts                 # PXE + embedded wallet setup
│   │   │   │   ├── contracts.ts              # Contract instance loaders
│   │   │   │   ├── pxeWarmup.ts              # Singleton eager PXE + WASM init
│   │   │   │   ├── UserProfileService.ts     # Points, eligibility, usernames
│   │   │   │   ├── VoteHistoryService.ts     # Encrypted vote direction records
│   │   │   │   ├── LinkRegistryService.ts    # Cross-device account linking
│   │   │   │   └── artifacts/                # Compiled contract JSON artifacts
│   │   │   ├── voteTracker.ts            # Pending vote tracking + optimistic deltas
│   │   │   ├── pointsTracker.ts          # Whisper points cache
│   │   │   └── username/                 # Deterministic username generation (wordlists)
│   │   │
│   │   ├── hooks/
│   │   │   ├── useAuthCompletion.ts      # Post-auth key derivation + JWT acquisition
│   │   │   ├── useDuelService.ts         # Artifact + contract loading for voting
│   │   │   ├── useCountdown.ts           # Block-based countdown timer
│   │   │   └── usePointsGate.ts          # Eligibility threshold check
│   │   │
│   │   ├── store/                        # Zustand global state
│   │   ├── providers/                    # React context + Wagmi config
│   │   └── types/
│   │
│   ├── vite.config.ts                # WASM serving, COOP/COEP headers, Aztec deps config
│   └── tailwind.config.ts
│
├── server/                       # Express + PostgreSQL backend
│   └── src/
│       ├── index.ts              # Server entry, CORS, rate limits, migrations, cron
│       │
│       ├── routes/
│       │   ├── auth.ts               # Challenge-response auth, JWT issuance
│       │   ├── duels.ts              # CRUD, search, chart data, vote sync
│       │   ├── commentsV2.ts         # Comments with voting (upvote/downvote)
│       │   ├── categories.ts         # Category listing
│       │   ├── subcategories.ts      # Subcategory listing
│       │   ├── users.ts              # User data endpoints
│       │   ├── deployAccount.ts      # Aztec account deployment proxy
│       │   ├── publishAccountClass.ts# Account class publication
│       │   ├── keeperCron.ts         # Manual cron trigger endpoint
│       │   ├── keeperWarmup.ts       # Keeper wallet pre-warm
│       │   └── registerSender.ts     # FPC sender registration
│       │
│       ├── middleware/
│       │   └── auth.ts               # JWT verification, challenge store
│       │
│       └── lib/
│           ├── snapshotCron.ts       # Vote snapshots, duel expiry, period advancement
│           ├── blockClock.ts         # Measured avg block time for duration estimates
│           ├── calendarPeriods.ts    # Calendar-aligned recurring period computation
│           ├── db/
│           │   ├── pool.ts               # PostgreSQL connection pool
│           │   └── migrate_v6-v9.ts      # Schema migrations (categories, slugs, indexes)
│           ├── keeper/
│           │   ├── wallet.ts             # Keeper Aztec account (admin operations)
│           │   ├── createDuelOnChain.ts  # Mutex-serialized on-chain duel creation
│           │   └── store.ts              # Contract instance management
│           └── aztec/
│               ├── publicStorageReader.ts# Direct L2 storage slot reads (no PXE)
│               └── artifacts/            # Server-side contract artifacts
│
├── contracts/                    # Noir + Aztec smart contracts
│   ├── Nargo.toml                # Workspace config
│   │
│   ├── duel_cloak/               # Main voting contract (V7)
│   │   └── src/
│   │       ├── main.nr
│   │       ├── duel_cloak.nr         # Core: cast_vote, apply_vote, submit_and_start_duel
│   │       ├── types/
│   │       │   ├── duel.nr               # DuelData struct + storage layout
│   │       │   └── vote_note.nr          # Private vote note type
│   │       └── test/                 # Noir unit tests
│   │           ├── voting_tests.nr       # Binary, option, level vote tests
│   │           ├── duel_lifecycle_tests.nr
│   │           └── constructor_tests.nr
│   │
│   ├── user_profile/             # Private points + eligibility (V5)
│   │   └── src/
│   │       ├── user_profile.nr       # add_points, prove_min_points, certify_eligible
│   │       └── types/
│   │           ├── point_note.nr         # Encrypted point accumulation
│   │           └── username_note.nr      # Encrypted username storage
│   │
│   ├── vote_history/             # Encrypted vote direction records
│   │   └── src/
│   │       ├── vote_history.nr       # record_vote, get_my_vote_for_duel
│   │       └── types/
│   │           └── vote_note.nr          # Per-duel encrypted vote direction
│   │
│   ├── link_registry/            # Cross-device account linking
│   │   └── src/
│   │       └── main.nr               # store_link, clear_link, get_target, get_vault
│   │
│   └── scripts/                  # Deployment scripts
│       ├── deploy.ts                 # Full 8-step devnet deployment
│       ├── deploy-v7.ts              # Cloakboard V7 (reuses keeper/FPC)
│       ├── deploy-user-profile-v5.ts # UserProfile V5 with eligibility
│       ├── deploy-vote-history.ts    # VoteHistory contract
│       └── deploy-link-registry.ts   # LinkRegistry contract
│
└── plans/                        # Design documents
```

## Architecture

### Privacy Architecture

Cloakboard is built on the principle that **no entity — including the server operator — should be able to link a user's real-world identity to their vote direction**. Privacy is enforced cryptographically at every layer, not by policy.

#### Private Accounts

All auth methods (Google OAuth, MetaMask, Phantom, WebAuthn Passkey) derive Aztec keys **entirely client-side** via HKDF. The browser takes the auth-method-specific seed (e.g. a signed challenge from MetaMask, an OAuth token hash from Google) and derives a deterministic `SchnorrAccount` keypair. The resulting on-chain identity is identical regardless of which auth method was used — only the seed generation differs.

The server **never receives**:
- Google email addresses or OAuth tokens
- Ethereum addresses or signed messages
- Solana public keys or Phantom signatures
- WebAuthn credential IDs or attestation data

The only identifier the server sees is the user's **Aztec-derived address** — a one-way hash of the signing key that cannot be reversed to recover the original auth credentials. Usernames are generated deterministically from wordlists based on the Aztec address, ensuring consistency without storing personal data.

Cross-device account linking is handled by the `LinkRegistry` contract. When a user links a second device, their Aztec keys are encrypted with AES-256-GCM and stored on-chain as 4 Field elements. Only someone who can authenticate with the same method on the new device can derive the decryption key and recover the primary account keys. The server never participates in the key exchange.

#### Private Voting

Votes are **browser-proved IVC (Incremental Verifiable Computation) proofs** generated via an embedded PXE and WASM prover running entirely in the user's browser. The proof is submitted directly to Aztec L2 — the server never sees which option was selected.

The vote flow preserves unlinkability:
1. `cast_vote` executes as a **private function** — the voter's address and vote direction are shielded inside the proof
2. The private function enqueues `apply_vote` (a public function marked `#[only_self]`) which increments aggregate tallies
3. Because `apply_vote` is called by the contract itself (not by the voter's address), **the voter's address never appears in public function arguments**
4. On-chain tallies are stored as aggregate counts only — the L2 state reveals how many people voted each way, but not who voted which way

**Double-vote prevention** uses a nullifier scheme: `hash(duel_id, nhk_app_secret)`. Each voter produces a unique nullifier per duel derived from their nullifier hash key. The nullifier tree prevents the same nullifier from being used twice, blocking double votes without revealing the voter's identity. An observer cannot determine which address produced which nullifier.

Vote direction is recorded privately in the `VoteHistory` contract as encrypted notes (`VoteNote`) that only the voter can decrypt. This allows the UI to show the user which way they voted without querying the server or exposing the information to anyone else.

#### Point Guards (Private Eligibility)

Whisper points are accumulated in the `UserProfile` contract as **encrypted private notes** (`PointNote`). Each time a user votes, a background transaction adds points as a new note in their private set. The server and other users cannot see any individual's point balance — notes are encrypted to the owner's keys and only decryptable by them.

When a feature requires a minimum point threshold (e.g. duel creation eligibility), the user proves they qualify without revealing their actual balance:

1. `certify_eligible(threshold)` executes as a private function in the browser
2. The IVC proof pops all the user's private point notes, sums them, and asserts `sum >= threshold`
3. The proof re-emits a single consolidated note (preserving the balance) and enqueues `mark_eligible` — a public function that writes a boolean flag to a public storage map
4. The server reads only the boolean flag via direct storage slot reads — it learns "this address is eligible" but never the underlying point count

This zero-knowledge eligibility gate means the server can enforce creation permissions without knowing how active any user is. The threshold proof is generated entirely in the browser.

### Voting Flow

1. User clicks vote button
2. Browser generates IVC proof (~10-15s) via embedded PXE + WASM
3. Proof submitted to Aztec L2 with `NO_WAIT` (returns after send, not mining)
4. Optimistic UI update + background sync polls for on-chain confirmation
5. Points awarded as fire-and-forget background tx
6. Vote direction recorded to VoteHistory contract (encrypted, private)

### Duel Types

- **Binary** — Agree/Disagree with time-series chart
- **Multi-item** — Multiple options, ranked by vote count
- **Level** — Scale-based voting with labeled levels
- **Recurring** — Calendar-aligned periods (daily/weekly/monthly) with per-period tallies

### Server Role

The server is a **coordination layer only** — it does not participate in voting:
- Stores duel metadata, comments, categories (PostgreSQL)
- Runs cron for vote snapshots (chart data) and on-chain tally sync
- Keeper account creates duels on-chain (admin-only operation)
- Serves as OAuth relay (Google) and account deployment proxy

## Development

```bash
# Frontend (port 5173)
cd app && npm run dev

# Backend (port 3001)
cd server && npm run dev

# Contract compilation (3-step pipeline)
cd contracts
nargo compile --workspace --force
# bb aztec_process + jq name stripping (see MEMORY.md for full pipeline)
```

## Deployed Contracts (Devnet)

| Contract | Address |
|----------|---------|
| Cloakboard V7 | `0x0dcf33d1db71f3f771bfeeed73fa00fd29c61e3449a5d87f318ec0aa265f068e` |
| UserProfile V5 | `0x277583987394370e5c070023a69e020eaa25336a6de3f831272fc2a9f5126c0e` |
| VoteHistory | `0x2a509cdb26fc851c0541ce6ef57f4f4b3ad506ee9a81d7b79eb82fbb19cf5102` |
| LinkRegistry | `0x228bc5129b036983a89051760c601d19f783acb95ca6889e74042eeec3a39d18` |
| Keeper | `0x2d5c737ae888f63c4e37b71ca2f2ca67f2bd9f08529bdee92a8505e09a98fbc0` |
| SponsoredFPC | `0x09a4df73aa47f82531a038d1d51abfc85b27665c4b7ca751e2d4fa9f19caffb2` |
