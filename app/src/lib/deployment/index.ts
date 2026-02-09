/**
 * Deployment Optimization Module
 *
 * Re-exports all deployment optimization utilities for easy importing.
 *
 * Usage:
 *   import { prewarmDeploymentArtifacts, getPrewarmedModules } from '@/lib/deployment';
 */

// Contract class pre-warming (disabled - causes conflicts)
export {
  preWarmGovernorBravoClass,
  isClassPublished,
  getGovernorBravoClassId,
  isPreWarmingInProgress,
  waitForPreWarming,
  clearClassCache,
} from './ContractClassCache';

// Artifact pre-warming
export {
  prewarmDeploymentArtifacts,
  getPrewarmedModules,
  isArtifactsPrewarmed,
  isPrewarmingInProgress,
  clearPrewarmedCache,
} from './ArtifactPrewarmer';

// Deployment preparation
export {
  prepareDeployment,
  getPreparedDeployment,
  invalidatePreparedDeployment,
  hasPreparedDeployment,
  isPreparationInProgress,
  waitForPreparation,
  computeConfigHash,
  type PreparedDeployment,
} from './DeploymentPreparer';
