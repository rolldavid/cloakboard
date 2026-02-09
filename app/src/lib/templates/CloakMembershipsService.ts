/**
 * CloakMemberships Service - Public User-Cloak Relationship Tracking with Roles
 *
 * Interacts with the CloakMemberships contract to manage public memberships.
 * Each membership has a role: MEMBER (1), ADMIN (2), or CREATOR (3).
 *
 * All data is PUBLIC:
 * - Which users are members of which cloaks
 * - Which cloaks a user belongs to
 * - What role each user has in each cloak
 *
 * Actions (voting, delegation) remain private in the cloak contracts.
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';
import { wrapContractWithCleanNames } from '@/lib/aztec/contracts';

/** Role constants matching the on-chain contract */
export const MembershipRole = {
  NONE: 0,
  MEMBER: 1,
  ADMIN: 2,
  CREATOR: 3,
} as const;

export type MembershipRoleValue = (typeof MembershipRole)[keyof typeof MembershipRole];

export class CloakMembershipsService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private senderAddress: AztecAddress | null = null;
  private paymentMethod: any | null = null;

  constructor(wallet: Wallet, senderAddress?: AztecAddress, paymentMethod?: any) {
    this.wallet = wallet;
    this.senderAddress = senderAddress ?? null;
    this.paymentMethod = paymentMethod ?? null;
  }

  /** Build options for simulate (view) calls. */
  private simOpts(): any {
    return this.senderAddress ? { from: this.senderAddress } : {};
  }

  /** Build options for send (state-changing) calls. */
  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  async connect(contractAddress: AztecAddress, artifact: any): Promise<void> {
    this.contract = wrapContractWithCleanNames(await Contract.at(contractAddress, artifact, this.wallet));
  }

  async deploy(artifact: any): Promise<AztecAddress> {
    const deployTx = await Contract.deploy(this.wallet, artifact, []).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
      from: AztecAddress.ZERO,
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.contract = deployed;
    return deployed.address;
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  // ===== MEMBERSHIP MANAGEMENT =====

  /**
   * Add a membership with a role (user joins a cloak)
   * @param role - 1=MEMBER, 2=ADMIN, 3=CREATOR
   */
  async addMembership(user: AztecAddress, cloak: AztecAddress, role: number = MembershipRole.MEMBER): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    await this.contract.methods
      .add_membership(user, cloak, role)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  /**
   * Remove a membership (user leaves a cloak)
   */
  async removeMembership(user: AztecAddress, cloak: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    await this.contract.methods
      .remove_membership(user, cloak)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== QUERY FUNCTIONS =====

  /**
   * Check if a user is a member of a cloak (any role > 0)
   */
  async isMember(user: AztecAddress, cloak: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .check_membership(user, cloak)
      .simulate(this.simOpts());
    return Boolean(result);
  }

  /**
   * Get the role of a user in a cloak (0=none, 1=member, 2=admin, 3=creator)
   */
  async getMemberRole(user: AztecAddress, cloak: AztecAddress): Promise<number> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .get_member_role(user, cloak)
      .simulate(this.simOpts());
    return Number(result);
  }

  /**
   * Get the number of cloaks a user is associated with
   */
  async getUserCloakCount(user: AztecAddress): Promise<number> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .get_user_cloak_count(user)
      .simulate(this.simOpts());
    return Number(result);
  }

  /**
   * Get a cloak address at a specific index for a user
   */
  async getUserCloakAt(user: AztecAddress, index: number): Promise<AztecAddress> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .get_user_cloak_at(user, index)
      .simulate(this.simOpts());
    return result;
  }

  /**
   * Get all cloaks for a user with their roles (filtered for active memberships)
   */
  async getUserCloaksWithRoles(user: AztecAddress): Promise<{ address: string; role: number }[]> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');

    const count = await this.getUserCloakCount(user);
    const results: { address: string; role: number }[] = [];

    for (let i = 0; i < count; i++) {
      const cloakAddr = await this.getUserCloakAt(user, i);
      const addrStr = cloakAddr.toString();

      if (addrStr === AztecAddress.ZERO.toString()) continue;

      // Get role (also serves as membership check — role 0 = removed)
      const role = await this.getMemberRole(user, cloakAddr);
      if (role > 0) {
        results.push({ address: addrStr, role });
      }
    }

    return results;
  }

  /**
   * Get all cloaks for a user (backward-compat wrapper, returns addresses only)
   */
  async getUserCloaks(user: AztecAddress): Promise<string[]> {
    const withRoles = await this.getUserCloaksWithRoles(user);
    return withRoles.map((r) => r.address);
  }

  /**
   * Get the number of members in a cloak
   */
  async getCloakMemberCount(cloak: AztecAddress): Promise<number> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .get_cloak_member_count(cloak)
      .simulate(this.simOpts());
    return Number(result);
  }

  /**
   * Get a member address at a specific index for a cloak
   */
  async getCloakMemberAt(cloak: AztecAddress, index: number): Promise<AztecAddress> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');
    const result = await this.contract.methods
      .get_cloak_member_at(cloak, index)
      .simulate(this.simOpts());
    return result;
  }

  /**
   * Get all members of a cloak (with membership check)
   */
  async getCloakMembers(cloak: AztecAddress): Promise<string[]> {
    if (!this.contract) throw new Error('Not connected to CloakMemberships');

    const count = await this.getCloakMemberCount(cloak);
    const members: string[] = [];

    for (let i = 0; i < count; i++) {
      const memberAddr = await this.getCloakMemberAt(cloak, i);
      const addrStr = memberAddr.toString();

      // Check if still a member (list may have stale entries)
      const stillMember = await this.isMember(memberAddr, cloak);
      if (stillMember && addrStr !== AztecAddress.ZERO.toString()) {
        members.push(addrStr);
      }
    }

    return members;
  }
}
