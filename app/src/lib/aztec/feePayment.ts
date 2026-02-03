import { AztecAddress } from '@aztec/aztec.js/addresses';
import { SponsoredFeePaymentMethod, type FeePaymentMethod } from '@aztec/aztec.js/fee';

export interface FeeStrategy {
  type: 'sponsored' | 'user_pays' | 'none';
  paymentMethod?: FeePaymentMethod;
}

// Default FPC addresses per network (these are deployed SponsoredFPC contracts)
export const DEFAULT_FPC_ADDRESSES: Record<string, string> = {
  sandbox: process.env.NEXT_PUBLIC_SPONSORED_FPC_ADDRESS || '',
  devnet: '0x1586f476995be97f07ebd415340a14be48dc28c6c661cc6bdddb80ae790caa4e',
  testnet: '', // To be configured
  mainnet: '', // To be configured
};

/**
 * Get the default FPC address for a network
 */
export function getDefaultFpcAddress(network: string): string | null {
  const address = DEFAULT_FPC_ADDRESSES[network];
  return address && address.length > 0 ? address : null;
}

/**
 * Create a fee payment method
 * In SDK 3.x, we use SponsoredFeePaymentMethod or return undefined for sandbox
 */
export function createFeePaymentMethod(fpcAddress?: AztecAddress): FeePaymentMethod | undefined {
  if (fpcAddress) {
    return new SponsoredFeePaymentMethod(fpcAddress);
  }
  // In sandbox mode without FPC, return undefined
  return undefined;
}

/**
 * Get the appropriate fee payment strategy based on Cloak configuration
 *
 * @param sponsoredEnabled - Whether the Cloak has sponsored voting enabled
 * @param fpcAddress - The FPC contract address from the Cloak
 * @returns FeeStrategy with payment method if sponsored
 */
export function getFeeStrategy(
  sponsoredEnabled: boolean,
  fpcAddress: AztecAddress | string | null
): FeeStrategy {
  if (!sponsoredEnabled || !fpcAddress) {
    return { type: 'none', paymentMethod: undefined };
  }

  const addressStr = typeof fpcAddress === 'string' ? fpcAddress : fpcAddress.toString();

  // Check if address is zero/empty
  if (!addressStr || addressStr === '0x0' || addressStr === AztecAddress.ZERO.toString()) {
    return { type: 'none', paymentMethod: undefined };
  }

  // Use SponsoredFeePaymentMethod with the FPC address
  const aztecAddress = typeof fpcAddress === 'string'
    ? AztecAddress.fromString(fpcAddress)
    : fpcAddress;

  return {
    type: 'sponsored',
    paymentMethod: new SponsoredFeePaymentMethod(aztecAddress),
  };
}

/**
 * Get fee options for a transaction based on the fee strategy
 */
export function getFeeOptions(strategy: FeeStrategy): { fee?: { paymentMethod: FeePaymentMethod } } {
  if (strategy.paymentMethod) {
    return { fee: { paymentMethod: strategy.paymentMethod } };
  }
  return {};
}
