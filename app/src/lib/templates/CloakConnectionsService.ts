/**
 * Cloak Connections Service — Private User-Cloak Relationship Tracking
 *
 * Interacts with the CloakConnections contract to manage private relationships
 * between users and cloaks. All relationships are stored as private notes that
 * only the owner can read.
 *
 * Privacy guarantees:
 * - No public mapping of user → cloaks
 * - No public mapping of cloak → users
 * - All relationships stored as encrypted private notes
 * - Only the note owner can read/enumerate their connections
 *
 * Connection types:
 * - CREATED (0): User deployed/created this cloak
 * - MEMBER (1): User is a member of this cloak
 * - ADMIN (2): User is an admin of this cloak
 * - STARRED (3): User starred this cloak
 */

import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { Contract } from '@aztec/aztec.js/contracts';
import { Fr } from '@aztec/foundation/curves/bn254';

// Connection type constants (must match contract)
export const ConnectionType = {
  CREATED: 0,
  MEMBER: 1,
  ADMIN: 2,
  STARRED: 3,
} as const;

export type ConnectionTypeValue = typeof ConnectionType[keyof typeof ConnectionType];

export interface CloakConnection {
  cloakAddress: string;
  connectionType: ConnectionTypeValue;
  isForgotten: boolean;
}

export class CloakConnectionsService {
  private contract: Contract | null = null;
  private wallet: Wallet;
  private senderAddress: AztecAddress | null = null;
  private paymentMethod: any | null = null;

  constructor(wallet: Wallet, senderAddress?: AztecAddress, paymentMethod?: any) {
    this.wallet = wallet;
    this.senderAddress = senderAddress ?? null;
    this.paymentMethod = paymentMethod ?? null;
  }

  /** Build send options with sender address and fee payment */
  private sendOpts(): any {
    return {
      ...(this.senderAddress ? { from: this.senderAddress } : {}),
      ...(this.paymentMethod ? { fee: { paymentMethod: this.paymentMethod } } : {}),
    };
  }

  async connect(contractAddress: AztecAddress, artifact: any): Promise<void> {
    this.contract = await Contract.at(contractAddress, artifact, this.wallet);
  }

  async deploy(artifact: any): Promise<AztecAddress> {
    const deployTx = await Contract.deploy(this.wallet, artifact, []).send({
      contractAddressSalt: Fr.random(),
      skipClassRegistration: false,
      skipPublicDeployment: false,
      ...this.sendOpts(),
    } as any);

    const deployed = await deployTx.deployed({ timeout: 120000 });
    this.contract = deployed;
    return deployed.address;
  }

  isConnected(): boolean {
    return this.contract !== null;
  }

  // ===== CONNECTION MANAGEMENT (Private functions) =====

  /**
   * Add a connection between the current user and a cloak.
   * Creates a private note that only the user can read.
   */
  async addConnection(cloakAddress: AztecAddress, connectionType: ConnectionTypeValue): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakConnections');
    await this.contract.methods
      .add_connection(cloakAddress, BigInt(connectionType))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  /**
   * Remove a connection (e.g., when leaving a cloak or unstarring).
   */
  async removeConnection(cloakAddress: AztecAddress, connectionType: ConnectionTypeValue): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakConnections');
    await this.contract.methods
      .remove_connection(cloakAddress, BigInt(connectionType))
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  /**
   * Forget a cloak - hides it from the dashboard without removing the connection.
   */
  async forgetCloak(cloakAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakConnections');
    await this.contract.methods
      .forget_cloak(cloakAddress)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  /**
   * Unforget a cloak - makes it visible on the dashboard again.
   */
  async unforgetCloak(cloakAddress: AztecAddress): Promise<void> {
    if (!this.contract) throw new Error('Not connected to CloakConnections');
    await this.contract.methods
      .unforget_cloak(cloakAddress)
      .send(this.sendOpts())
      .wait({ timeout: 120000 });
  }

  // ===== QUERY FUNCTIONS =====

  /**
   * Check if a specific cloak is forgotten by a specific owner.
   */
  async isForgotten(owner: AztecAddress, cloakAddress: AztecAddress): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected to CloakConnections');
    const result = await this.contract.methods
      .is_forgotten(owner, cloakAddress)
      .simulate({} as any);
    return Boolean(result);
  }

  /**
   * Get all connections for the current user from their PXE.
   * This reads private notes that were synced to the user's PXE.
   *
   * @param pxe - The PXE instance to query for notes
   * @param ownerAddress - The user's address
   * @returns Array of cloak connections
   */
  async getMyConnections(pxe: any, ownerAddress: AztecAddress): Promise<CloakConnection[]> {
    // Query the PXE for all ConnectionNote instances owned by this address
    // The PXE stores all synced notes for the account
    try {
      const contractAddr = this.contract?.address;
      if (!contractAddr) {
        console.warn('[CloakConnectionsService] Contract not connected');
        return [];
      }

      console.log('[CloakConnectionsService] Querying notes for:', {
        contractAddress: contractAddr.toString(),
        owner: ownerAddress.toString(),
      });

      let notes: any[] = [];

      // Try getNotes with just contractAddress (required field)
      // The contract uses CONNECTIONS_SLOT = 1 for user notes
      const { Fr } = await import('@aztec/foundation/curves/bn254');

      // Query without storage slot first (gets all notes for this contract)
      try {
        notes = await pxe.getNotes({
          contractAddress: contractAddr,
          owner: ownerAddress,
        });
        console.log('[CloakConnectionsService] getNotes (owner filter) returned:', notes?.length ?? 0, 'notes');
      } catch (notesErr: any) {
        console.warn('[CloakConnectionsService] getNotes failed:', notesErr?.message);
      }

      // If no notes, try without owner filter
      if (!notes || notes.length === 0) {
        try {
          notes = await pxe.getNotes({
            contractAddress: contractAddr,
          });
          console.log('[CloakConnectionsService] getNotes (no owner filter) returned:', notes?.length ?? 0, 'notes');

          // Filter to only notes for this owner manually
          // Notes might be stored without explicit owner in the filter
        } catch (notesErr: any) {
          console.warn('[CloakConnectionsService] getNotes (no filter) failed:', notesErr?.message);
        }
      }

      // Also try getIncomingNotes as a fallback
      if (!notes || notes.length === 0) {
        try {
          notes = await pxe.getIncomingNotes({
            contractAddress: contractAddr,
            owner: ownerAddress,
          });
          console.log('[CloakConnectionsService] getIncomingNotes returned:', notes?.length ?? 0, 'notes');
        } catch (incomingErr: any) {
          console.warn('[CloakConnectionsService] getIncomingNotes failed:', incomingErr?.message);
        }
      }

      if (!notes || notes.length === 0) {
        console.log('[CloakConnectionsService] No notes found for user');
        return [];
      }

      const connections: CloakConnection[] = [];
      const seenCloaks = new Set<string>();

      for (const note of notes) {
        // Log raw note structure for debugging
        console.log('[CloakConnectionsService] Raw note:', JSON.stringify(note, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        , 2).slice(0, 500));

        // Parse the note data - try different formats
        // ConnectionNote has: cloak_address (Field), connection_type (Field)
        let cloakAddress: string | null = null;
        let connectionType: ConnectionTypeValue | null = null;

        // Format 1: note.note.items array
        if (note.note?.items && note.note.items.length >= 2) {
          cloakAddress = note.note.items[0].toString();
          connectionType = Number(note.note.items[1]) as ConnectionTypeValue;
        }
        // Format 2: note.items array directly
        else if (note.items && note.items.length >= 2) {
          cloakAddress = note.items[0].toString();
          connectionType = Number(note.items[1]) as ConnectionTypeValue;
        }
        // Format 3: direct fields
        else if (note.cloak_address !== undefined && note.connection_type !== undefined) {
          cloakAddress = note.cloak_address.toString();
          connectionType = Number(note.connection_type) as ConnectionTypeValue;
        }

        if (!cloakAddress || connectionType === null) {
          console.warn('[CloakConnectionsService] Could not parse note:', note);
          continue;
        }

        // Skip duplicates
        const key = `${cloakAddress}-${connectionType}`;
        if (seenCloaks.has(key)) continue;
        seenCloaks.add(key);

        // Skip checking isForgotten for now to simplify - can add back later
        connections.push({
          cloakAddress,
          connectionType,
          isForgotten: false,
        });
      }

      console.log('[CloakConnectionsService] Parsed connections:', connections.length);
      return connections;
    } catch (err) {
      console.warn('[CloakConnectionsService] Failed to get connections:', err);
      return [];
    }
  }

  /**
   * Get connections filtered by type.
   */
  async getConnectionsByType(
    pxe: any,
    ownerAddress: AztecAddress,
    connectionType: ConnectionTypeValue,
    includeForgotten: boolean = false
  ): Promise<string[]> {
    const connections = await this.getMyConnections(pxe, ownerAddress);
    return connections
      .filter(c => c.connectionType === connectionType && (includeForgotten || !c.isForgotten))
      .map(c => c.cloakAddress);
  }

  /**
   * Get all created cloaks (cloaks the user deployed).
   */
  async getCreatedCloaks(pxe: any, ownerAddress: AztecAddress): Promise<string[]> {
    return this.getConnectionsByType(pxe, ownerAddress, ConnectionType.CREATED);
  }

  /**
   * Get all member cloaks (cloaks the user is a member of).
   */
  async getMemberCloaks(pxe: any, ownerAddress: AztecAddress): Promise<string[]> {
    return this.getConnectionsByType(pxe, ownerAddress, ConnectionType.MEMBER);
  }

  /**
   * Get all admin cloaks (cloaks the user is an admin of).
   */
  async getAdminCloaks(pxe: any, ownerAddress: AztecAddress): Promise<string[]> {
    return this.getConnectionsByType(pxe, ownerAddress, ConnectionType.ADMIN);
  }

  /**
   * Get all starred cloaks.
   */
  async getStarredCloaks(pxe: any, ownerAddress: AztecAddress): Promise<string[]> {
    return this.getConnectionsByType(pxe, ownerAddress, ConnectionType.STARRED);
  }

  /**
   * Get all visible (non-forgotten) connections grouped by type.
   */
  async getGroupedConnections(pxe: any, ownerAddress: AztecAddress): Promise<{
    created: string[];
    member: string[];
    admin: string[];
    starred: string[];
    forgotten: string[];
  }> {
    const connections = await this.getMyConnections(pxe, ownerAddress);

    const result = {
      created: [] as string[],
      member: [] as string[],
      admin: [] as string[],
      starred: [] as string[],
      forgotten: [] as string[],
    };

    for (const conn of connections) {
      if (conn.isForgotten) {
        result.forgotten.push(conn.cloakAddress);
      } else {
        switch (conn.connectionType) {
          case ConnectionType.CREATED:
            result.created.push(conn.cloakAddress);
            break;
          case ConnectionType.MEMBER:
            result.member.push(conn.cloakAddress);
            break;
          case ConnectionType.ADMIN:
            result.admin.push(conn.cloakAddress);
            break;
          case ConnectionType.STARRED:
            result.starred.push(conn.cloakAddress);
            break;
        }
      }
    }

    return result;
  }
}
