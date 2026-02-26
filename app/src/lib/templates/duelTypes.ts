/**
 * Pure types and constants for DuelCloak — no Aztec dependencies.
 * Components should import from here to avoid pulling in @aztec/* at load time.
 */

export enum DuelRole { None = 0, Member = 1, Council = 2, Creator = 3 }

export interface DuelInfo {
  id: number;
  statementText: string;
  startBlock: number;
  endBlock: number;
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  isTallied: boolean;
  startedBy: string;
}

export interface DuelCloakConfig {
  name: string;
  description: string;
  duelDuration: number;
  firstDuelBlock: number;
  visibility: 'open' | 'closed';
  keeperAddress?: string;
  accountClassId?: string;
  creatorAddress?: string;
  statements?: string[];
  tallyMode?: number;
}

export interface RemovalProposalInfo {
  id: number;
  target: string;
  proposer: string;
  startBlock: number;
  endBlock: number;
  executed: boolean;
  result: 'pending' | 'removed' | 'kept';
  keepVotes: number;
  removeVotes: number;
}

const CHARS_PER_FIELD = 25;
export const MAX_STATEMENT_LENGTH = CHARS_PER_FIELD * 4;
