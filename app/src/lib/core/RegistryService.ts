/**
 * Registry Service
 *
 * Service for interacting with the CloakRegistry contract.
 * Handles Cloak registration, membership tracking, and lookups.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

/**
 * Cloak information stored in the registry
 */
export interface CloakInfo {
  address: string;
  nameHash: string;
  templateId: number;
  createdAt: number;
  isActive: boolean;
  creator: string;
  memberCount: number;
}

/**
 * Membership types
 */
export enum MembershipType {
  NotMember = 0,
  Member = 1,
  Admin = 2,
  Creator = 3,
}

/**
 * User's membership in a Cloak
 */
export interface UserMembership {
  cloakAddress: string;
  membershipType: MembershipType;
}

/**
 * Service for interacting with the Cloak Registry contract
 */
export class RegistryService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private registryAddress: AztecAddress | null = null;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  /**
   * Initialize the service with the registry contract address
   */
  async initialize(registryAddress: AztecAddress, artifact: any): Promise<void> {
    this.registryAddress = registryAddress;
    this.contract = await Contract.at(registryAddress, artifact, this.wallet);

  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.contract !== null;
  }

  /**
   * Register a new Cloak in the registry
   */
  async registerCloak(
    cloakAddress: AztecAddress,
    nameHash: Fr,
    friendlyIdHash: Fr,
    templateId: number,
    creator: AztecAddress,
  ): Promise<void> {
    if (!this.contract) throw new Error('Registry not initialized');

    await this.contract.methods
      .register_cloak(cloakAddress, nameHash, friendlyIdHash, templateId, creator)
      .send({ fee: undefined } as any)
      .wait({ timeout: 120000 });


  }

  /**
   * Add a membership record
   */
  async addMembership(
    user: AztecAddress,
    cloakAddress: AztecAddress,
    membershipType: MembershipType,
  ): Promise<void> {
    if (!this.contract) throw new Error('Registry not initialized');

    await this.contract.methods
      .add_membership(user, cloakAddress, membershipType)
      .send({ fee: undefined } as any)
      .wait({ timeout: 120000 });


  }

  /**
   * Remove a membership record
   */
  async removeMembership(user: AztecAddress, cloakAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Registry not initialized');

    await this.contract.methods
      .remove_membership(user, cloakAddress)
      .send({ fee: undefined } as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Update membership type (e.g., promote to admin)
   */
  async updateMembershipType(
    user: AztecAddress,
    cloakAddress: AztecAddress,
    newType: MembershipType,
  ): Promise<void> {
    if (!this.contract) throw new Error('Registry not initialized');

    await this.contract.methods
      .update_membership_type(user, cloakAddress, newType)
      .send({ fee: undefined } as any)
      .wait({ timeout: 120000 });
  }

  /**
   * Get Cloak information from the registry
   */
  async getCloakInfo(cloakAddress: AztecAddress): Promise<CloakInfo> {
    if (!this.contract) throw new Error('Registry not initialized');

    const result = await this.contract.methods.get_cloak_info(cloakAddress).simulate({} as any);

    // Result is a tuple: (name_hash, template_id, created_at, is_active, creator, member_count)
    return {
      address: cloakAddress.toString(),
      nameHash: result[0].toString(),
      templateId: Number(result[1]),
      createdAt: Number(result[2]),
      isActive: Boolean(result[3]),
      creator: result[4].toString(),
      memberCount: Number(result[5]),
    };
  }

  /**
   * Resolve a friendly ID to a Cloak address
   */
  async resolveFriendlyId(friendlyIdHash: Fr): Promise<AztecAddress | null> {
    if (!this.contract) throw new Error('Registry not initialized');

    const address = await this.contract.methods.resolve_friendly_id(friendlyIdHash).simulate({} as any);

    // Check if address is zero (not found)
    if (address.isZero?.() || address.toString() === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }

    return address;
  }

  /**
   * Get user's membership type in a Cloak
   */
  async getUserMembership(user: AztecAddress, cloakAddress: AztecAddress): Promise<MembershipType> {
    if (!this.contract) throw new Error('Registry not initialized');

    const membershipType = await this.contract.methods
      .get_user_membership(user, cloakAddress)
      .simulate({} as any);

    return Number(membershipType) as MembershipType;
  }

  /**
   * Get the count of Cloaks a user belongs to
   */
  async getUserCloakCount(user: AztecAddress): Promise<number> {
    if (!this.contract) throw new Error('Registry not initialized');

    const count = await this.contract.methods.get_user_cloak_count(user).simulate({} as any);
    return Number(count);
  }

  /**
   * Get the member count of a Cloak
   */
  async getCloakMemberCount(cloakAddress: AztecAddress): Promise<number> {
    if (!this.contract) throw new Error('Registry not initialized');

    const count = await this.contract.methods.get_cloak_member_count(cloakAddress).simulate({} as any);
    return Number(count);
  }

  /**
   * Get total number of Cloaks registered
   */
  async getTotalCloaks(): Promise<number> {
    if (!this.contract) throw new Error('Registry not initialized');

    const count = await this.contract.methods.get_total_cloaks().simulate({} as any);
    return Number(count);
  }

  /**
   * Check if a Cloak is registered
   */
  async isCloakRegistered(cloakAddress: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Registry not initialized');

    const registered = await this.contract.methods.is_cloak_registered(cloakAddress).simulate({} as any);
    return Boolean(registered);
  }

  /**
   * Get membership type label
   */
  static getMembershipLabel(type: MembershipType): string {
    switch (type) {
      case MembershipType.NotMember:
        return 'Not a Member';
      case MembershipType.Member:
        return 'Member';
      case MembershipType.Admin:
        return 'Admin';
      case MembershipType.Creator:
        return 'Creator';
      default:
        return 'Unknown';
    }
  }

  /**
   * Hash a string for use as name hash or friendly ID
   */
  static hashString(str: string): Fr {
    // Simple hash - in production use a proper hash function
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    let hash = BigInt(0);
    for (let i = 0; i < data.length; i++) {
      hash = (hash * BigInt(31) + BigInt(data[i])) % (BigInt(2) ** BigInt(254));
    }
    return new Fr(hash);
  }
}
