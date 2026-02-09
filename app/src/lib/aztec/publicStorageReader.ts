/**
 * Public Storage Reader — Direct node reads bypassing wallet/PXE/kernel.
 *
 * Uses `node.getPublicStorageAt('latest', contract, slot)` to read raw public
 * storage directly from the AztecNode. This works immediately — no wallet,
 * no account deployment, no signing key notes required.
 *
 * CloakMemberships storage layout (slot numbers from struct field order):
 *   slot 1: user_cloak_count   — Map<AztecAddress, PublicMutable<u32>>
 *   slot 2: user_cloaks        — Map<AztecAddress, Map<u32, PublicMutable<AztecAddress>>>
 *   slot 3: membership_role    — Map<AztecAddress, Map<AztecAddress, PublicMutable<u8>>>
 *   slot 4: cloak_member_count — Map<AztecAddress, PublicMutable<u32>>
 *   slot 5: cloak_members      — Map<AztecAddress, Map<u32, PublicMutable<AztecAddress>>>
 *
 * CloakRegistry storage layout:
 *   slot 1: name_to_cloak — Map<Field, PublicMutable<AztecAddress>>
 *   slot 2: cloak_to_name — Map<AztecAddress, PublicMutable<Field>>
 *   slot 3: cloak_count   — PublicMutable<u64>
 */

import type { AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';

// --- CloakMemberships slot constants ---
const MEMBERSHIPS_SLOT_USER_CLOAK_COUNT = new Fr(1n);
const MEMBERSHIPS_SLOT_USER_CLOAKS = new Fr(2n);
const MEMBERSHIPS_SLOT_MEMBERSHIP_ROLE = new Fr(3n);

// --- CloakRegistry slot constants ---
const REGISTRY_SLOT_CLOAK_TO_NAME = new Fr(2n);

/**
 * Decompress a Field value (from FieldCompressedString) back to a UTF-8 string.
 * FieldCompressedString packs up to 31 bytes of a string into a single Field element
 * in big-endian order.
 */
export function decompressFieldToString(fieldValue: bigint): string {
  if (fieldValue === 0n) return '';

  const bytes = new Uint8Array(31);
  let val = fieldValue;
  for (let i = 30; i >= 0; i--) {
    bytes[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  // Trim trailing null bytes and decode as UTF-8
  let end = 31;
  while (end > 0 && bytes[end - 1] === 0) {
    end--;
  }

  return new TextDecoder().decode(bytes.slice(0, end));
}

// ===== CloakMemberships reads =====

/**
 * Get the number of cloaks a user belongs to.
 */
export async function getUserCloakCount(
  node: AztecNode,
  membershipsContract: AztecAddress,
  user: AztecAddress,
): Promise<number> {
  const slot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_USER_CLOAK_COUNT, user);
  const value = await node.getPublicStorageAt('latest', membershipsContract, slot);
  return Number(value.toBigInt());
}

/**
 * Get the cloak address at a specific index for a user.
 */
export async function getUserCloakAt(
  node: AztecNode,
  membershipsContract: AztecAddress,
  user: AztecAddress,
  index: number,
): Promise<AztecAddress> {
  // Nested map: user_cloaks.at(user).at(index)
  const outerSlot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_USER_CLOAKS, user);
  // For the inner map key (u32 index), wrap in an object with toField()
  const indexKey = { toField: () => new Fr(BigInt(index)) };
  const innerSlot = await deriveStorageSlotInMap(outerSlot, indexKey);
  const value = await node.getPublicStorageAt('latest', membershipsContract, innerSlot);
  return AztecAddress.fromField(value);
}

/**
 * Get the role of a user in a specific cloak (0=none, 1=member, 2=admin, 3=creator).
 */
export async function getMemberRole(
  node: AztecNode,
  membershipsContract: AztecAddress,
  user: AztecAddress,
  cloak: AztecAddress,
): Promise<number> {
  // Nested map: membership_role.at(user).at(cloak)
  const outerSlot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_MEMBERSHIP_ROLE, user);
  const innerSlot = await deriveStorageSlotInMap(outerSlot, cloak);
  const value = await node.getPublicStorageAt('latest', membershipsContract, innerSlot);
  return Number(value.toBigInt());
}

/**
 * Get all cloaks for a user with their roles (filtered for active memberships).
 * Returns an array of { address, role } pairs where role > 0.
 */
export async function getUserCloaksWithRoles(
  node: AztecNode,
  membershipsContract: AztecAddress,
  user: AztecAddress,
): Promise<{ address: string; role: number }[]> {
  const count = await getUserCloakCount(node, membershipsContract, user);
  const results: { address: string; role: number }[] = [];

  for (let i = 0; i < count; i++) {
    const cloakAddr = await getUserCloakAt(node, membershipsContract, user, i);
    const addrStr = cloakAddr.toString();

    if (addrStr === AztecAddress.ZERO.toString()) continue;

    const role = await getMemberRole(node, membershipsContract, user, cloakAddr);
    if (role > 0) {
      results.push({ address: addrStr, role });
    }
  }

  return results;
}

// ===== CloakRegistry reads =====

/**
 * Get the compressed name field for a cloak address from CloakRegistry.
 * Returns the decompressed string, or null if not registered.
 */
export async function getCloakNameField(
  node: AztecNode,
  registryContract: AztecAddress,
  cloakAddress: AztecAddress,
): Promise<string | null> {
  const slot = await deriveStorageSlotInMap(REGISTRY_SLOT_CLOAK_TO_NAME, cloakAddress);
  const value = await node.getPublicStorageAt('latest', registryContract, slot);
  const fieldValue = value.toBigInt();
  if (fieldValue === 0n) return null;
  return decompressFieldToString(fieldValue);
}
