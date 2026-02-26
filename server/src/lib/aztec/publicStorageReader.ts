/**
 * Public Storage Reader — Direct node reads for DuelCloak public state.
 *
 * Bypasses PXE simulation entirely. Reads raw storage slots from the Aztec node
 * via node.getPublicStorageAt(). Faster, simpler, zero simulation overhead.
 *
 * Storage slot layout (verified empirically):
 * PublicImmutable uses 2 slots (init flag + value), PublicMutable uses 1, Map uses 1 base.
 *
 *  1-2: name (PublicImmutable<FieldCompressedString>) — 2 slots
 *  3-4: creator (PublicImmutable<AztecAddress>) — 2 slots
 *  5-6: keeper (PublicImmutable<AztecAddress>) — 2 slots
 *  7-8: allowed_account_class_id (PublicImmutable<Field>) — 2 slots
 *   9:  duel_duration (PublicMutable<u32>) — 1 slot
 *  10:  first_duel_block (PublicMutable<u32>) — 1 slot
 *  11:  is_publicly_viewable (PublicMutable<bool>) — 1 slot
 *  12:  member_roles (Map) — 1 base slot
 *  13:  member_count (PublicMutable<u64>) — 1 slot
 *  14:  council_count (PublicMutable<u64>) — 1 slot
 *  15:  statement_pool (Map) — 1 base slot
 *  16:  statement_by_index (Map) — 1 base slot
 *  17:  statement_count (PublicMutable<u64>) — 1 slot
 *  18:  current_duel_id (PublicMutable<u64>) — 1 slot
 *  19:  duel_count (PublicMutable<u64>) — 1 slot
 *  20:  duels (Map<Field, PublicMutable<Duel>>) — 1 base slot
 *  21:  removal_count (PublicMutable<u64>) — 1 slot
 *  ...
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
import type { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';

// PublicImmutable uses 2 slots each (init flag + value), so 4 immutables = 8 slots offset
const CURRENT_DUEL_ID_SLOT = new Fr(18n);
const DUEL_COUNT_SLOT = new Fr(19n);
const DUELS_MAP_SLOT = new Fr(20n);
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

  // Read all 12 fields sequentially (devnet RPC can't handle 12 parallel requests)
  const fields: any[] = [];
  for (let i = 0; i < DUEL_FIELD_COUNT; i++) {
    fields.push(await node.getPublicStorageAt('latest', contractAddress, new Fr(baseSlot + BigInt(i))));
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
