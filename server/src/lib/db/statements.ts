import { pool } from './pool.js';

export interface StatementRow {
  id: number;
  cloak_address: string;
  statement_hash: string;
  statement_text: string;
  on_chain: boolean;
  used_in_duel_id: number | null;
  created_at: string;
}

export async function insertStatement(
  cloakAddress: string,
  statementHash: string,
  statementText: string,
): Promise<StatementRow> {
  const result = await pool.query(
    `INSERT INTO statements (cloak_address, statement_hash, statement_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (cloak_address, statement_hash) DO NOTHING
     RETURNING *`,
    [cloakAddress, statementHash, statementText],
  );
  return result.rows[0];
}

export async function markStatementOnChain(
  cloakAddress: string,
  statementHash: string,
): Promise<void> {
  await pool.query(
    `UPDATE statements SET on_chain = TRUE WHERE cloak_address = $1 AND statement_hash = $2`,
    [cloakAddress, statementHash],
  );
}

export async function getNextAvailableStatement(
  cloakAddress: string,
): Promise<StatementRow | null> {
  const result = await pool.query(
    `SELECT * FROM statements
     WHERE cloak_address = $1 AND used_in_duel_id IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [cloakAddress],
  );
  return result.rows[0] || null;
}

export async function markStatementUsed(
  cloakAddress: string,
  statementHash: string,
  duelId: number,
): Promise<void> {
  await pool.query(
    `UPDATE statements SET used_in_duel_id = $3
     WHERE cloak_address = $1 AND statement_hash = $2`,
    [cloakAddress, statementHash, duelId],
  );
}

export async function getAvailableStatementCount(
  cloakAddress: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM statements
     WHERE cloak_address = $1 AND used_in_duel_id IS NULL`,
    [cloakAddress],
  );
  return result.rows[0].count;
}
