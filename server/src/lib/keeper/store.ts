import { pool } from '../db/pool.js';
import type { KeeperEntry } from './types.js';

export function getKeeperStore() {
  return {
    async list(): Promise<KeeperEntry[]> {
      const result = await pool.query(
        `SELECT cloak_address, cloak_name, cloak_slug, tally_mode, sender_addresses
         FROM keeper_cloaks ORDER BY created_at ASC`,
      );
      return result.rows.map(rowToEntry);
    },

    async get(cloakAddress: string): Promise<KeeperEntry | undefined> {
      const result = await pool.query(
        `SELECT cloak_address, cloak_name, cloak_slug, tally_mode, sender_addresses
         FROM keeper_cloaks WHERE cloak_address = $1`,
        [cloakAddress],
      );
      return result.rows[0] ? rowToEntry(result.rows[0]) : undefined;
    },

    async add(entry: KeeperEntry): Promise<void> {
      await pool.query(
        `INSERT INTO keeper_cloaks (cloak_address, cloak_name, cloak_slug, tally_mode, sender_addresses)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cloak_address) DO UPDATE SET
           cloak_name = COALESCE(NULLIF($2, ''), keeper_cloaks.cloak_name),
           cloak_slug = COALESCE(NULLIF($3, ''), keeper_cloaks.cloak_slug),
           tally_mode = $4,
           sender_addresses = $5,
           updated_at = NOW()`,
        [
          entry.cloakAddress,
          entry.cloakName,
          entry.cloakSlug,
          entry.tallyMode,
          entry.senderAddresses,
        ],
      );
    },

    async addSender(cloakAddress: string, senderAddress: string): Promise<void> {
      // Only append if not already present
      await pool.query(
        `UPDATE keeper_cloaks
         SET sender_addresses = array_append(sender_addresses, $2),
             updated_at = NOW()
         WHERE cloak_address = $1 AND NOT ($2 = ANY(sender_addresses))`,
        [cloakAddress, senderAddress],
      );
    },

    async getSenders(cloakAddress: string): Promise<string[]> {
      const result = await pool.query(
        `SELECT sender_addresses FROM keeper_cloaks WHERE cloak_address = $1`,
        [cloakAddress],
      );
      return result.rows[0]?.sender_addresses || [];
    },
  };
}

function rowToEntry(row: any): KeeperEntry {
  return {
    cloakAddress: row.cloak_address,
    cloakName: row.cloak_name,
    cloakSlug: row.cloak_slug,
    tallyMode: row.tally_mode,
    senderAddresses: row.sender_addresses || [],
  };
}
