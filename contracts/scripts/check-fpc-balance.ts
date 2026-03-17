import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/foundation/curves/bn254';
import { deriveStorageSlotInMap } from '@aztec/stdlib/hash';

async function main() {
  const node = createAztecNodeClient('https://rpc.testnet.aztec-labs.com/');
  const block = await node.getBlockNumber();
  console.log('Current block:', block);

  // FeeJuice is protocol contract at address 5
  const FEE_JUICE_ADDRESS = AztecAddress.fromString('0x0000000000000000000000000000000000000000000000000000000000000005');
  const BALANCES_SLOT = new Fr(1n);
  const fpcAddr = AztecAddress.fromString('0x1e40113d9000f4a5adf4f01a2414b6444b4ade5e4d17a29d1d0986719a59fbba');

  const slot = await deriveStorageSlotInMap(BALANCES_SLOT, fpcAddr);
  const val = await node.getPublicStorageAt('latest', FEE_JUICE_ADDRESS, slot);
  console.log('FPC balance (raw):', val.toBigInt().toString());
  console.log('FPC balance (FEE):', (Number(val.toBigInt()) / 1e18).toFixed(2));

  // Also check keeper balance
  const keeperAddr = AztecAddress.fromString('0x1d9d390362853345f3e5717bdb0defe6e76618ea098aade3d4929cb50a66bc55');
  const keeperSlot = await deriveStorageSlotInMap(BALANCES_SLOT, keeperAddr);
  const keeperVal = await node.getPublicStorageAt('latest', FEE_JUICE_ADDRESS, keeperSlot);
  console.log('Keeper balance (raw):', keeperVal.toBigInt().toString());
  console.log('Keeper balance (FEE):', (Number(keeperVal.toBigInt()) / 1e18).toFixed(2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
