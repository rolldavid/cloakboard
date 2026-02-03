/**
 * Dashboard Service
 *
 * Service for fetching and managing dashboard data.
 * Aggregates data from Cloak Registry and individual Cloaks.
 */

import type { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { RegistryService, MembershipType, type CloakInfo } from './RegistryService';

/**
 * Extended Cloak info for dashboard display
 */
export interface DashboardCloak extends CloakInfo {
  membershipType: MembershipType;
  templateName: string;
  privacyLevel: 'maximum' | 'balanced' | 'transparent';
  recentActivity?: {
    proposalCount: number;
    lastActivityAt: number;
  };
}

/**
 * Dashboard section type
 */
export type DashboardSection = 'created' | 'admin' | 'member';

/**
 * Grouped Cloaks by user's role
 */
export interface GroupedCloaks {
  created: DashboardCloak[];
  admin: DashboardCloak[];
  member: DashboardCloak[];
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  totalCloaks: number;
  createdCloaks: number;
  adminCloaks: number;
  memberCloaks: number;
  totalVotingPower: bigint;
}

/**
 * Template ID to name mapping
 */
const TEMPLATE_NAMES: Record<number, string> = {
  1: 'Organization',
  2: 'Treasury',
  3: 'Workplace Organizing',
  4: 'Investment Club',
  5: 'Grants Committee',
  6: 'Governor Bravo',
  7: 'Collector',
  8: 'Service Guild',
  9: 'Social Club',
  10: 'Research',
};

/**
 * Privacy preset ID to level mapping
 */
const PRIVACY_LEVELS: Record<number, 'maximum' | 'balanced' | 'transparent'> = {
  0: 'maximum',
  1: 'balanced',
  2: 'transparent',
};

/**
 * Service for managing dashboard data
 */
export class DashboardService {
  private registryService: RegistryService;
  private wallet: Wallet;
  private userAddress: AztecAddress;

  constructor(wallet: Wallet, userAddress: AztecAddress) {
    this.wallet = wallet;
    this.userAddress = userAddress;
    this.registryService = new RegistryService(wallet);
  }

  /**
   * Initialize the service
   */
  async initialize(registryAddress: AztecAddress, registryArtifact: any): Promise<void> {
    await this.registryService.initialize(registryAddress, registryArtifact);
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.registryService.isInitialized();
  }

  /**
   * Get all Cloaks the user is involved with, grouped by role
   */
  async getUserCloaks(): Promise<GroupedCloaks> {
    const result: GroupedCloaks = {
      created: [],
      admin: [],
      member: [],
    };

    // For now, we can't enumerate Cloaks directly from the registry
    // This would require either:
    // 1. Backend indexer that tracks membership events
    // 2. Local storage of known Cloak addresses
    // 3. Registry contract modification to support enumeration
    //
    // For MVP, we'll load from local storage (aztecStore)
    // and enrich with on-chain data

    return result;
  }

  /**
   * Get user's Cloaks from a list of known addresses
   */
  async enrichCloakList(cloakAddresses: AztecAddress[]): Promise<GroupedCloaks> {
    const result: GroupedCloaks = {
      created: [],
      admin: [],
      member: [],
    };

    for (const cloakAddress of cloakAddresses) {
      try {
        // Get Cloak info from registry
        const cloakInfo = await this.registryService.getCloakInfo(cloakAddress);

        // Get user's membership type
        const membershipType = await this.registryService.getUserMembership(
          this.userAddress,
          cloakAddress
        );

        if (membershipType === MembershipType.NotMember) {
          continue;
        }

        // Create dashboard Cloak entry
        const dashboardCloak: DashboardCloak = {
          ...cloakInfo,
          membershipType,
          templateName: TEMPLATE_NAMES[cloakInfo.templateId] || 'Unknown',
          privacyLevel: PRIVACY_LEVELS[0] || 'balanced', // Default, would need to fetch from Cloak
        };

        // Group by membership type
        switch (membershipType) {
          case MembershipType.Creator:
            result.created.push(dashboardCloak);
            break;
          case MembershipType.Admin:
            result.admin.push(dashboardCloak);
            break;
          case MembershipType.Member:
            result.member.push(dashboardCloak);
            break;
        }
      } catch (err) {
        console.error(`[DashboardService] Failed to load Cloak ${cloakAddress}:`, err);
      }
    }

    return result;
  }

  /**
   * Get dashboard statistics
   */
  async getStats(groupedCloaks: GroupedCloaks): Promise<DashboardStats> {
    const totalCloaks =
      groupedCloaks.created.length + groupedCloaks.admin.length + groupedCloaks.member.length;

    return {
      totalCloaks,
      createdCloaks: groupedCloaks.created.length,
      adminCloaks: groupedCloaks.admin.length,
      memberCloaks: groupedCloaks.member.length,
      totalVotingPower: 0n, // Would need to aggregate from each Cloak
    };
  }

  /**
   * Get total number of Cloaks in the system
   */
  async getTotalSystemCloaks(): Promise<number> {
    return this.registryService.getTotalCloaks();
  }

  /**
   * Get Cloak details by address
   */
  async getCloakDetails(cloakAddress: AztecAddress): Promise<DashboardCloak | null> {
    try {
      const cloakInfo = await this.registryService.getCloakInfo(cloakAddress);
      const membershipType = await this.registryService.getUserMembership(
        this.userAddress,
        cloakAddress
      );

      return {
        ...cloakInfo,
        membershipType,
        templateName: TEMPLATE_NAMES[cloakInfo.templateId] || 'Unknown',
        privacyLevel: PRIVACY_LEVELS[0] || 'balanced',
      };
    } catch (err) {
      console.error('[DashboardService] Failed to get Cloak details:', err);
      return null;
    }
  }

  /**
   * Get template name from ID
   */
  static getTemplateName(templateId: number): string {
    return TEMPLATE_NAMES[templateId] || 'Unknown';
  }

  /**
   * Get all template options
   */
  static getTemplateOptions(): Array<{ id: number; name: string }> {
    return Object.entries(TEMPLATE_NAMES).map(([id, name]) => ({
      id: parseInt(id),
      name,
    }));
  }
}

/**
 * Singleton instance (created when needed)
 */
let dashboardServiceInstance: DashboardService | null = null;

/**
 * Get or create dashboard service instance
 */
export function getDashboardService(
  wallet: Wallet,
  userAddress: AztecAddress
): DashboardService {
  if (!dashboardServiceInstance) {
    dashboardServiceInstance = new DashboardService(wallet, userAddress);
  }
  return dashboardServiceInstance;
}

/**
 * Clear dashboard service instance (on logout)
 */
export function clearDashboardService(): void {
  dashboardServiceInstance = null;
}
