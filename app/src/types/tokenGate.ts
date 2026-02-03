/**
 * Token gating types for Private Cloak membership
 */

/** Membership method for Cloak access control */
export type MembershipMethod = 'invite-only' | 'email-domain' | 'aztec-token' | 'erc20-token';

/** Configuration for Aztec native token gating */
export interface AztecTokenConfig {
  mode: 'create-new' | 'use-existing';
  /** Address of existing Aztec token (use-existing mode) */
  existingTokenAddress?: string;
  /** Name for new governance token (create-new mode) */
  newTokenName?: string;
  /** Symbol for new governance token (create-new mode) */
  newTokenSymbol?: string;
  /** Aragon-style initial token distribution */
  initialDistribution?: Array<{ address: string; amount: string }>;
  /** Optional multisig-controlled treasury */
  multisigTreasury?: {
    enabled: boolean;
    /** Tokens to mint to multisig treasury */
    amount: string;
    /** 1-5 Aztec addresses as signers */
    signers: string[];
    /** Number of approvals needed to move tokens */
    threshold: number;
  };
  /** Minimum token balance to join as member */
  minMembershipBalance: string;
  /** Minimum token balance to create proposals */
  minProposerBalance: string;
}

/** Configuration for ERC20 token gating via ZK proof */
export interface ERC20TokenConfig {
  /** L1 ERC20 contract address */
  tokenAddress: string;
  /** Ethereum chain ID (1=mainnet, 8453=base, 11155111=sepolia) */
  chainId: number;
  /** ERC20 storage slot for balances mapping (usually 0) */
  balanceSlot: number;
  /** Minimum token balance to join as member */
  minMembershipBalance: string;
  /** Minimum token balance to create proposals */
  minProposerBalance: string;
}

/** Combined token gate configuration */
export interface TokenGateConfig {
  method: MembershipMethod;
  aztecToken?: AztecTokenConfig;
  erc20Token?: ERC20TokenConfig;
}

/** ERC20 proof data generated client-side */
export interface ERC20ProofData {
  proof: Uint8Array;
  publicInputs: string[];
  verifiedBalance: string;
  nullifier: string;
  chainId: number;
  blockNumber: number;
  tokenAddress: string;
}

/** Supported Ethereum chains for ERC20 gating */
export const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum Mainnet', rpcEnvKey: 'NEXT_PUBLIC_ETH_RPC_URL' },
  { id: 8453, name: 'Base', rpcEnvKey: 'NEXT_PUBLIC_BASE_RPC_URL' },
  { id: 11155111, name: 'Sepolia', rpcEnvKey: 'NEXT_PUBLIC_SEPOLIA_RPC_URL' },
] as const;

/** Default token gate config */
export const DEFAULT_TOKEN_GATE_CONFIG: TokenGateConfig = {
  method: 'invite-only',
};

/** Default Aztec token config */
export const DEFAULT_AZTEC_TOKEN_CONFIG: AztecTokenConfig = {
  mode: 'create-new',
  newTokenName: '',
  newTokenSymbol: '',
  initialDistribution: [{ address: '', amount: '1000000' }],
  multisigTreasury: {
    enabled: false,
    amount: '0',
    signers: [],
    threshold: 1,
  },
  minMembershipBalance: '1',
  minProposerBalance: '100',
};

/** Default ERC20 token config */
export const DEFAULT_ERC20_TOKEN_CONFIG: ERC20TokenConfig = {
  tokenAddress: '',
  chainId: 1,
  balanceSlot: 0,
  minMembershipBalance: '1',
  minProposerBalance: '100',
};
