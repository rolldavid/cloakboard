import { pool } from './pool.js';

export interface StatementRow {
  id: number;
  cloak_address: string;
  statement_hash: string;
  statement_text: string;
  on_chain: boolean;
  used_in_duel_id: number | null;
  sort_order: number;
  created_at: string;
}

// Ensure sort_order column exists (safe to call multiple times)
let _sortOrderMigrated = false;
async function ensureSortOrder(): Promise<void> {
  if (_sortOrderMigrated) return;
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'statements' AND column_name = 'sort_order') THEN
        ALTER TABLE statements ADD COLUMN sort_order INTEGER;
      END IF;
    END $$;
    UPDATE statements SET sort_order = id WHERE sort_order IS NULL;
  `);
  _sortOrderMigrated = true;
}

export async function insertStatement(
  cloakAddress: string,
  statementHash: string,
  statementText: string,
): Promise<StatementRow> {
  await ensureSortOrder();
  const result = await pool.query(
    `INSERT INTO statements (cloak_address, statement_hash, statement_text, sort_order)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) FROM statements WHERE cloak_address = $1), 0) + 1)
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
  await ensureSortOrder();
  const result = await pool.query(
    `SELECT * FROM statements
     WHERE cloak_address = $1 AND used_in_duel_id IS NULL
     ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
    [cloakAddress],
  );
  return result.rows[0] || null;
}

export async function deleteStatement(
  statementId: number,
  cloakAddress: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM statements WHERE id = $1 AND cloak_address = $2 AND used_in_duel_id IS NULL`,
    [statementId, cloakAddress],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function reorderStatements(
  cloakAddress: string,
  orderedIds: number[],
): Promise<void> {
  await ensureSortOrder();
  // Set sort_order based on position in the array
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE statements SET sort_order = $1 WHERE id = $2 AND cloak_address = $3 AND used_in_duel_id IS NULL`,
        [i + 1, orderedIds[i], cloakAddress],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
