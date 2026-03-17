/**
 * Public Storage Reader — Direct node reads for DuelCloak public state.
 *
 * Bypasses PXE simulation entirely. Reads raw storage slots from the Aztec node
 * via node.getPublicStorageAt(). Faster, simpler, zero simulation overhead.
 *
 * DuelCloak V10 storage slot layout:
 * PublicImmutable uses 2 slots (init flag + value), PublicMutable uses 1, Map uses 1 base.
 *
 *  1-2: name (PublicImmutable<FieldCompressedString>)
 *  3-4: creator (PublicImmutable<AztecAddress>)
 *  5-6: keeper (PublicImmutable<AztecAddress>)
 *   7:  duel_duration (PublicMutable<u32>)
 *   8:  first_duel_block (PublicMutable<u32>)
 *   9:  is_publicly_viewable (PublicMutable<bool>)
 *  10:  member_roles (Map)
 *  11:  member_count (PublicMutable<u64>)
 *  12:  council_count (PublicMutable<u64>)
 *  13:  statement_pool (Map)
 *  14:  statement_by_index (Map)
 *  15:  statement_count (PublicMutable<u64>)
 *  16:  current_duel_id (PublicMutable<u64>)
 *  17:  duel_count (PublicMutable<u64>)
 *  18:  duels (Map<Field, PublicMutable<Duel>>)
 *  19:  removal_count (PublicMutable<u64>)
 *  20:  removal_proposals (Map)
 *  21:  removal_votes (Map)
 *  22:  removal_keep_votes (Map)
 *  23:  removal_remove_votes (Map)
 *  24:  removal_vote_duration (PublicMutable<u32>)
 *  25:  option_votes (Map<Field, Map<Field, PublicMutable<u64>>>)
 *  26:  level_votes (Map<Field, Map<Field, PublicMutable<u64>>>)
 * 27-28: user_profile_address (PublicImmutable<AztecAddress>)
 *  29:  vote_stakes (Owned<PrivateSet>)
 *  30:  duel_outcomes (Map)
 *  31:  duel_finalized (Map)
 *
 * Duel struct field order (0-based offset from derived map slot):
 *   0: id (u64)
 *   1: statement_part_1 (Field)
 *   2: statement_part_2 (Field)
 *   3: statement_part_3 (Field)
 *   4: statement_part_4 (Field)
 *   5: start_block (u32)
 *   6: end_block (u32)
 *   7: total_votes (u64)
 *   8: agree_votes (u64)
 *   9: disagree_votes (u64)
 *  10: is_tallied (bool)
 *  11: started_by (AztecAddress)
 */

import type { AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';

// V10: allowed_account_class_id removed — all slots after keeper shifted down by 2
const CURRENT_DUEL_ID_SLOT = new Fr(16n);
const DUEL_COUNT_SLOT = new Fr(17n);
const DUELS_MAP_SLOT = new Fr(18n);
const DUEL_FIELD_COUNT = 12; // Duel struct has 12 fields

export interface DuelData {
  id: number;
  statementPart1: bigint;
  statementPart2: bigint;
  statementPart3: bigint;
  statementPart4: bigint;
  startBlock: number;
  endBlock: number;
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  isTallied: boolean;
  startedBy: string;
}

export async function readDuelDirect(
  node: AztecNode, contractAddress: AztecAddress, duelId: number,
): Promise<DuelData> {
  const duelIdKey = { toField: () => new Fr(BigInt(duelId)) };
  const derivedSlot = await deriveStorageSlotInMap(DUELS_MAP_SLOT, duelIdKey);
  const baseSlot = derivedSlot.toBigInt();

  // Read 12 fields in parallel batches of 4 (testnet handles small batches)
  const fields: any[] = new Array(DUEL_FIELD_COUNT);
  for (let batch = 0; batch < DUEL_FIELD_COUNT; batch += 4) {
    const end = Math.min(batch + 4, DUEL_FIELD_COUNT);
    const promises = [];
    for (let i = batch; i < end; i++) {
      promises.push(
        node.getPublicStorageAt('latest', contractAddress, new Fr(baseSlot + BigInt(i)))
          .then((val: any) => { fields[i] = val; })
      );
    }
    await Promise.all(promises);
  }

  return {
    id: Number(fields[0].toBigInt()),
    statementPart1: fields[1].toBigInt(),
    statementPart2: fields[2].toBigInt(),
    statementPart3: fields[3].toBigInt(),
    statementPart4: fields[4].toBigInt(),
    startBlock: Number(fields[5].toBigInt()),
    endBlock: Number(fields[6].toBigInt()),
    totalVotes: Number(fields[7].toBigInt()),
    agreeVotes: Number(fields[8].toBigInt()),
    disagreeVotes: Number(fields[9].toBigInt()),
    isTallied: fields[10].toBigInt() !== 0n,
    startedBy: fields[11].toBigInt().toString(),
  };
}

export async function readDuelCount(
  node: AztecNode, contractAddress: AztecAddress,
): Promise<number> {
  const val = await node.getPublicStorageAt('latest', contractAddress, DUEL_COUNT_SLOT);
  return Number(val.toBigInt());
}

export async function readCurrentDuelId(
  node: AztecNode, contractAddress: AztecAddress,
): Promise<number> {
  const val = await node.getPublicStorageAt('latest', contractAddress, CURRENT_DUEL_ID_SLOT);
  return Number(val.toBigInt());
}

// V10: option_votes and level_votes shifted down by 2 (allowed_account_class_id removed)
const OPTION_VOTES_MAP_SLOT = new Fr(25n);
const LEVEL_VOTES_MAP_SLOT = new Fr(26n);

/**
 * Read vote count for a specific option in a multi-item duel.
 * Storage: option_votes[duel_id][option_index]
 */
export async function readOptionVoteCount(
  node: AztecNode, contractAddress: AztecAddress,
  duelId: number, optionIndex: number,
): Promise<number> {
  const outerKey = { toField: () => new Fr(BigInt(duelId)) };
  const outerSlot = await deriveStorageSlotInMap(OPTION_VOTES_MAP_SLOT, outerKey);
  const innerKey = { toField: () => new Fr(BigInt(optionIndex)) };
  const innerSlot = await deriveStorageSlotInMap(outerSlot, innerKey);
  const val = await node.getPublicStorageAt('latest', contractAddress, innerSlot);
  return Number(val.toBigInt());
}

/**
 * Read vote count for a specific level in a level duel.
 * Storage: level_votes[duel_id][level]
 */
export async function readLevelVoteCount(
  node: AztecNode, contractAddress: AztecAddress,
  duelId: number, level: number,
): Promise<number> {
  const outerKey = { toField: () => new Fr(BigInt(duelId)) };
  const outerSlot = await deriveStorageSlotInMap(LEVEL_VOTES_MAP_SLOT, outerKey);
  const innerKey = { toField: () => new Fr(BigInt(level)) };
  const innerSlot = await deriveStorageSlotInMap(outerSlot, innerKey);
  const val = await node.getPublicStorageAt('latest', contractAddress, innerSlot);
  return Number(val.toBigInt());
}

// ─── UserProfile: Eligibility ─────────────────────────────────────
// Storage slot for eligible_creators Map in UserProfile contract.
// UserProfile storage: user_points (slot 1, Owned<PrivateSet>), user_names (slot 2, Owned<PrivateSet>),
// eligible_creators (slot 3, Map<Field, PublicMutable<bool>>).
const ELIGIBLE_CREATORS_SLOT = new Fr(3n);

/**
 * Read whether a user is eligible to create duels from UserProfile public storage.
 * Returns true if the user has certified their eligibility on-chain.
 */
export async function readUserEligibility(
  node: AztecNode,
  userProfileAddress: AztecAddress,
  userAztecAddress: string,
): Promise<boolean> {
  const userField = AztecAddress.fromString(userAztecAddress).toField();
  const key = { toField: () => userField };
  const derivedSlot = await deriveStorageSlotInMap(ELIGIBLE_CREATORS_SLOT, key);
  const val = await node.getPublicStorageAt('latest', userProfileAddress, derivedSlot);
  return val.toBigInt() !== 0n;
}
