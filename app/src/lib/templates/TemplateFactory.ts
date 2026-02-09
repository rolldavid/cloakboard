/**
 * Template Factory
 *
 * Factory for creating Cloak template service instances.
 * Maps template IDs to their corresponding service classes.
 *
 * Active:
 * 1. Bravo (Governor Bravo)
 *
 * Coming soon:
 * 2. Strike (Organizing)
 * 3. Gossip
 * 4. Ape (Treasury)
 * 5. Give (Grants)
 * 6. Coop (Workplace)
 * 7. Glass (Anonymous feedback)
 * 8. Swarm (Collective social)
 * 9. Ballot (Private voting)
 */

import type { Wallet } from '@aztec/aztec.js/wallet';
import type { AztecAddress } from '@aztec/aztec.js/addresses';

import { GovernorBravoCloakService } from './GovernorBravoCloakService';
import { OrganizationCloakService } from './OrganizationCloakService';
import { TreasuryCloakService } from './TreasuryCloakService';
import { GrantsCloakService } from './GrantsCloakService';
import { WorkplaceCloakService } from './WorkplaceCloakService';

/**
 * Template ID to service class mapping
 */
export const TEMPLATE_SERVICES = {
  1: GovernorBravoCloakService,
  2: OrganizationCloakService,
  // 3: GossipCloakService — placeholder, needs creation later
  4: TreasuryCloakService,
  5: GrantsCloakService,
  6: WorkplaceCloakService,
} as const;

/**
 * Template ID type
 */
export type TemplateId = keyof typeof TEMPLATE_SERVICES;

/**
 * Service instance type for a given template ID
 */
export type ServiceForTemplate<T extends TemplateId> = InstanceType<(typeof TEMPLATE_SERVICES)[T]>;

/**
 * Union of all service types
 */
export type AnyCloakService =
  | GovernorBravoCloakService
  | OrganizationCloakService
  | TreasuryCloakService
  | GrantsCloakService
  | WorkplaceCloakService;

/**
 * Create a service instance for a given template ID
 */
export function createServiceForTemplate<T extends TemplateId>(
  templateId: T,
  wallet: Wallet
): ServiceForTemplate<T> {
  const ServiceClass = TEMPLATE_SERVICES[templateId];
  return new ServiceClass(wallet) as ServiceForTemplate<T>;
}

/**
 * Connect to an existing Cloak with the appropriate service
 */
export async function connectToCloak(
  templateId: TemplateId,
  wallet: Wallet,
  cloakAddress: AztecAddress,
  artifact: any
): Promise<AnyCloakService> {
  const service = createServiceForTemplate(templateId, wallet);
  await service.connect(cloakAddress, artifact);
  return service;
}

/**
 * Check if a template ID is valid
 */
export function isValidTemplateId(id: number): id is TemplateId {
  return id in TEMPLATE_SERVICES;
}

/**
 * Get template name by ID
 */
export function getTemplateName(templateId: TemplateId): string {
  const names: Record<TemplateId, string> = {
    1: 'Bravo',
    2: 'Strike',
    4: 'Ape',
    5: 'Give',
    6: 'Coop',
  };
  return names[templateId];
}

/**
 * Get template description by ID
 */
export function getTemplateDescription(templateId: TemplateId): string {
  const descriptions: Record<TemplateId, string> = {
    1: 'Full Governor Bravo implementation with private voting, delegation, and timelock',
    2: 'Organization governance with domain-gated membership',
    4: 'Collective fund management with transparent finances',
    5: 'Community funding with application and milestone tracking',
    6: 'Maximum privacy for workplace organizing',
  };
  return descriptions[templateId];
}

/**
 * Get default privacy level for a template
 */
export function getDefaultPrivacy(templateId: TemplateId): 'transparent' | 'balanced' | 'maximum' {
  const privacyLevels: Record<TemplateId, 'transparent' | 'balanced' | 'maximum'> = {
    1: 'balanced',
    2: 'balanced',
    4: 'balanced',
    5: 'balanced',
    6: 'maximum',
  };
  return privacyLevels[templateId];
}

/**
 * Get all template IDs
 */
export function getAllTemplateIds(): TemplateId[] {
  return [1, 2, 4, 5, 6];
}

/**
 * Get templates by privacy level
 */
export function getTemplatesByPrivacy(
  privacyLevel: 'transparent' | 'balanced' | 'maximum'
): TemplateId[] {
  return getAllTemplateIds().filter((id) => getDefaultPrivacy(id) === privacyLevel);
}
