// Cloak Types
export interface CloakConfig {
  name: string;
  votingDuration: number;
  quorumThreshold: number;
  upgradeAuthority?: string;
}

export interface CloakInfo {
  address: string;
  name: string;
  admin: string;
  memberCount: number;
  proposalCount: number;
  votingDuration: number;
  quorumThreshold: number;
}

// Proposal Types
export interface Proposal {
  id: number;
  creator: string;
  title: string;
  description: string;
  proposalType: ProposalType;
  targetAddress: string;
  value: bigint;
  startBlock: number;
  endBlock: number;
  executed: boolean;
}

export enum ProposalType {
  Treasury = 0,
  Member = 1,
  Settings = 2,
}

export interface VoteTally {
  yesVotes: bigint;
  noVotes: bigint;
  totalVotes: bigint;
}

export interface ProposalWithTally extends Proposal {
  tally: VoteTally;
}

// Account Types
export interface AccountInfo {
  address: string;
  publicKey: string;
  isDeployed: boolean;
}

// Transaction Types
export interface TransactionResult {
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}

// Network Types
export type NetworkEnvironment = 'local' | 'devnet' | 'testnet' | 'mainnet';

export interface NetworkConfig {
  name: string;
  nodeUrl: string;
  environment: NetworkEnvironment;
  sponsoredFpcAddress?: string;
}
