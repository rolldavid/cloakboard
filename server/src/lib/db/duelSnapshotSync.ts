import { pool } from './pool.js';

export interface DuelSnapshotData {
  cloakAddress: string;
  cloakName: string;
  cloakSlug: string;
  duelId: number;
  statementText: string;
  startBlock: number;
  endBlock: number;
  totalVotes: number;
  agreeVotes: number;
  disagreeVotes: number;
  isTallied: boolean;
}

export async function upsertDuelSnapshot(data: DuelSnapshotData): Promise<void> {
  await pool.query(
    `INSERT INTO duel_snapshots
       (cloak_address, cloak_name, cloak_slug, duel_id, statement_text,
        start_block, end_block, total_votes, agree_votes, disagree_votes, is_tallied)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (cloak_address, duel_id) DO UPDATE SET
       cloak_name = $2, cloak_slug = $3, statement_text = $5,
       start_block = $6, end_block = $7, total_votes = $8,
       agree_votes = $9, disagree_votes = $10, is_tallied = $11,
       updated_at = NOW()`,
    [
      data.cloakAddress, data.cloakName, data.cloakSlug, data.duelId,
      data.statementText, data.startBlock, data.endBlock,
      data.totalVotes, data.agreeVotes, data.disagreeVotes, data.isTallied,
    ],
  );
}

export async function getSnapshotCount(cloakAddress: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM duel_snapshots WHERE cloak_address = $1`,
    [cloakAddress],
  );
  return result.rows[0].count;
}
