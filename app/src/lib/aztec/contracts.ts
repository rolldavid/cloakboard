/**
 * Contract helpers — artifact loading, name wrapping.
 */

import { loadContractArtifact } from '@aztec/stdlib/abi';

const INTERNAL_PREFIX = '__aztec_nr_internals__';

export function loadNargoArtifact(rawArtifact: any): any {
  rawArtifact.transpiled = true;
  return loadContractArtifact(rawArtifact);
}

/**
 * Wrap a Contract instance with a Proxy that maps clean method names
 * to prefixed names in the artifact, preserving correct function selectors.
 */
export function wrapContractWithCleanNames(contract: any): any {
  const originalMethods = contract.methods;

  const methodsProxy = new Proxy(originalMethods, {
    get(target: any, prop: string | symbol) {
      if (typeof prop === 'string' && typeof target[prop] === 'function') {
        return target[prop].bind(target);
      }
      if (typeof prop === 'string') {
        const prefixedName = INTERNAL_PREFIX + prop;
        if (typeof target[prefixedName] === 'function') {
          return target[prefixedName].bind(target);
        }
      }
      return target[prop];
    },
  });

  return new Proxy(contract, {
    get(target: any, prop: string | symbol) {
      if (prop === 'methods') return methodsProxy;
      return target[prop];
    },
  });
}

let cachedDuelCloakArtifact: any = null;
export async function getDuelCloakArtifact(): Promise<any> {
  if (!cachedDuelCloakArtifact) {
    const module = await import('./artifacts/DuelCloak.json');
    cachedDuelCloakArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedDuelCloakArtifact;
}

let cachedMultiAuthArtifact: any = null;
export async function getMultiAuthAccountArtifact(): Promise<any> {
  if (!cachedMultiAuthArtifact) {
    const module = await import('./artifacts/MultiAuthAccount.json');
    cachedMultiAuthArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedMultiAuthArtifact;
}

let cachedCloakMembershipsArtifact: any = null;
export async function getCloakMembershipsArtifact(): Promise<any> {
  if (!cachedCloakMembershipsArtifact) {
    const module = await import('./artifacts/CloakMemberships.json');
    cachedCloakMembershipsArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedCloakMembershipsArtifact;
}

let cachedUserProfileArtifact: any = null;
export async function getUserProfileArtifact(): Promise<any> {
  if (!cachedUserProfileArtifact) {
    const module = await import('./artifacts/UserProfile.json');
    cachedUserProfileArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedUserProfileArtifact;
}

let cachedVoteHistoryArtifact: any = null;
export async function getVoteHistoryArtifact(): Promise<any> {
  if (!cachedVoteHistoryArtifact) {
    const module = await import('./artifacts/VoteHistory.json');
    cachedVoteHistoryArtifact = loadNargoArtifact(module.default as any);
  }
  return cachedVoteHistoryArtifact;
}
