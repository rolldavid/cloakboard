/**
 * Per-User Cloak Connections Storage
 *
 * Stores cloak connections in localStorage keyed by user address.
 * This is a fallback for when Aztec private notes can't be discovered
 * due to PXE fast-sync (which skips historical blocks).
 *
 * The on-chain CloakConnections contract remains the source of truth,
 * but this provides a reliable way to restore connections across sessions.
 */

const STORAGE_KEY_PREFIX = 'cloak-connections-';

export interface LocalCloakConnection {
  cloakAddress: string;
  cloakName?: string;
  connectionType: 'created' | 'member' | 'admin' | 'starred';
  addedAt: number;
}

/**
 * Get the storage key for a user
 */
function getStorageKey(userAddress: string): string {
  return `${STORAGE_KEY_PREFIX}${userAddress.toLowerCase()}`;
}

/**
 * Get all stored connections for a user
 */
export function getUserConnections(userAddress: string): LocalCloakConnection[] {
  if (typeof window === 'undefined') return [];

  try {
    const key = getStorageKey(userAddress);
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (err) {
    console.warn('[userCloakConnections] Failed to read connections:', err);
    return [];
  }
}

/**
 * Add a connection for a user
 */
export function addUserConnection(
  userAddress: string,
  connection: Omit<LocalCloakConnection, 'addedAt'>
): void {
  if (typeof window === 'undefined') return;

  try {
    const connections = getUserConnections(userAddress);

    // Check if already exists
    const exists = connections.some(
      c => c.cloakAddress.toLowerCase() === connection.cloakAddress.toLowerCase() &&
           c.connectionType === connection.connectionType
    );

    if (exists) return;

    connections.push({
      ...connection,
      addedAt: Date.now(),
    });

    const key = getStorageKey(userAddress);
    localStorage.setItem(key, JSON.stringify(connections));
  } catch (err) {
    console.warn('[userCloakConnections] Failed to add connection:', err);
  }
}

/**
 * Remove a connection for a user
 */
export function removeUserConnection(
  userAddress: string,
  cloakAddress: string,
  connectionType: LocalCloakConnection['connectionType']
): void {
  if (typeof window === 'undefined') return;

  try {
    const connections = getUserConnections(userAddress);
    const filtered = connections.filter(
      c => !(c.cloakAddress.toLowerCase() === cloakAddress.toLowerCase() &&
             c.connectionType === connectionType)
    );

    const key = getStorageKey(userAddress);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.warn('[userCloakConnections] Failed to remove connection:', err);
  }
}

/**
 * Get connections by type
 */
export function getUserConnectionsByType(
  userAddress: string,
  connectionType: LocalCloakConnection['connectionType']
): LocalCloakConnection[] {
  return getUserConnections(userAddress).filter(c => c.connectionType === connectionType);
}

/**
 * Clear all connections for a user
 */
export function clearUserConnections(userAddress: string): void {
  if (typeof window === 'undefined') return;

  try {
    const key = getStorageKey(userAddress);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[userCloakConnections] Failed to clear connections:', err);
  }
}

/**
 * Update cloak name for a connection
 */
export function updateConnectionName(
  userAddress: string,
  cloakAddress: string,
  cloakName: string
): void {
  if (typeof window === 'undefined') return;

  try {
    const connections = getUserConnections(userAddress);
    let updated = false;

    for (const conn of connections) {
      if (conn.cloakAddress.toLowerCase() === cloakAddress.toLowerCase()) {
        conn.cloakName = cloakName;
        updated = true;
      }
    }

    if (updated) {
      const key = getStorageKey(userAddress);
      localStorage.setItem(key, JSON.stringify(connections));
    }
  } catch (err) {
    console.warn('[userCloakConnections] Failed to update connection name:', err);
  }
}
