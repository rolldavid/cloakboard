/**
 * App-gated fee payment method — calls AppFPC.sponsor() instead of
 * SponsoredFPC.sponsor_unconditionally(). The AppFPC contract verifies
 * the sender is in the approved set before paying the fee.
 */

import type { FeePaymentMethod } from '@aztec/aztec.js/fee';
import { FunctionCall, FunctionSelector, FunctionType } from '@aztec/stdlib/abi';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { GasSettings } from '@aztec/stdlib/gas';
import { ExecutionPayload } from '@aztec/stdlib/tx';

export class AppFeePaymentMethod implements FeePaymentMethod {
  constructor(private fpcAddress: AztecAddress) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error('Asset is not required for app-gated FPC.');
  }

  getFeePayer() {
    return Promise.resolve(this.fpcAddress);
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    return new ExecutionPayload(
      [
        FunctionCall.from({
          name: 'sponsor',
          to: this.fpcAddress,
          selector: await FunctionSelector.fromSignature('sponsor()'),
          type: FunctionType.PRIVATE,
          hideMsgSender: false,
          isStatic: false,
          args: [],
          returnTypes: [],
        }),
      ],
      [],
      [],
      [],
      this.fpcAddress,
    );
  }

  getGasSettings(): GasSettings | undefined {
    return;
  }
}
