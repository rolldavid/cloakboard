/**
 * Public Storage Reader — Direct node reads bypassing wallet/PXE/kernel.
 */

import type { AztecNode } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';

const MEMBERSHIPS_SLOT_USER_CLOAK_COUNT = new Fr(1n);
const MEMBERSHIPS_SLOT_USER_CLOAKS = new Fr(2n);
const MEMBERSHIPS_SLOT_MEMBERSHIP_ROLE = new Fr(3n);

export function decompressFieldToString(fieldValue: bigint): string {
  if (fieldValue === 0n) return '';
  const bytes = new Uint8Array(31);
  let val = fieldValue;
  for (let i = 30; i >= 0; i--) {
    bytes[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  let end = 31;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
}

export async function getUserCloakCount(
  node: AztecNode, membershipsContract: AztecAddress, user: AztecAddress,
): Promise<number> {
  const slot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_USER_CLOAK_COUNT, user);
  const value = await node.getPublicStorageAt('latest', membershipsContract, slot);
  return Number(value.toBigInt());
}

export async function getUserCloakAt(
  node: AztecNode, membershipsContract: AztecAddress, user: AztecAddress, index: number,
): Promise<AztecAddress> {
  const outerSlot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_USER_CLOAKS, user);
  const indexKey = { toField: () => new Fr(BigInt(index)) };
  const innerSlot = await deriveStorageSlotInMap(outerSlot, indexKey);
  const value = await node.getPublicStorageAt('latest', membershipsContract, innerSlot);
  return AztecAddress.fromField(value);
}

export async function getMemberRole(
  node: AztecNode, membershipsContract: AztecAddress, user: AztecAddress, cloak: AztecAddress,
): Promise<number> {
  const outerSlot = await deriveStorageSlotInMap(MEMBERSHIPS_SLOT_MEMBERSHIP_ROLE, user);
  const innerSlot = await deriveStorageSlotInMap(outerSlot, cloak);
  const value = await node.getPublicStorageAt('latest', membershipsContract, innerSlot);
  return Number(value.toBigInt());
}

export async function getUserCloaksWithRoles(
  node: AztecNode, membershipsContract: AztecAddress, user: AztecAddress,
): Promise<{ address: string; role: number }[]> {
  const count = await getUserCloakCount(node, membershipsContract, user);
  const results: { address: string; role: number }[] = [];

  for (let i = 0; i < count; i++) {
    const cloakAddr = await getUserCloakAt(node, membershipsContract, user, i);
    const addrStr = cloakAddr.toString();
    if (addrStr === AztecAddress.ZERO.toString()) continue;
    const role = await getMemberRole(node, membershipsContract, user, cloakAddr);
    if (role > 0) results.push({ address: addrStr, role });
  }

  return results;
}
