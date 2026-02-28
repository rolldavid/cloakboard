/**
 * POST /api/submit-statement  — Add a statement to the queue
 * GET  /api/submit-statement  — List pending (unused) statements for a cloak
 *
 * Statement text → Postgres (no on-chain, no keeper).
 * On-chain hash submission happens later when advance-duel picks it.
 */

import { Router, type Request, type Response } from 'express';
import { insertStatement, deleteStatement, reorderStatements } from '../lib/db/statements';
import { pool } from '../lib/db/pool.js';

const router = Router();

// GET /api/submit-statement?cloakAddress=...
router.get('/', async (req: Request, res: Response) => {
  const cloakAddress = req.query.cloakAddress as string;
  if (!cloakAddress) {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }

  try {
    const result = await pool.query(
      `SELECT id, statement_text, created_at FROM statements
       WHERE cloak_address = $1 AND used_in_duel_id IS NULL
       ORDER BY sort_order ASC, created_at ASC LIMIT 10`,
      [cloakAddress],
    );
    return res.json({ statements: result.rows.map((r) => ({ id: r.id, text: r.statement_text, createdAt: r.created_at })) });
  } catch (err: any) {
    console.error('[submit-statement:get] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const { cloakAddress, text } = req.body;

  if (!cloakAddress || typeof cloakAddress !== 'string') {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty text' });
  }
  if (text.length > 100) {
    return res.status(400).json({ error: 'Statement text exceeds 100 characters' });
  }

  const userAddress = req.headers['x-user-address'] as string | undefined;
  const skipRoleCheck = req.headers['x-skip-role-check'] === 'true';

  // TODO: If not skipRoleCheck, verify user is Council+ via on-chain read
  // For now, accept all submissions (access control enforced at cloak level)

  try {
    // Compute hash for uniqueness
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashHex = '0x' + Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    await insertStatement(cloakAddress, hashHex, text.trim());

    return res.json({ status: 'success', statementHash: hashHex });
  } catch (err: any) {
    if (err?.message?.includes('duplicate') || err?.code === '23505') {
      return res.status(409).json({ error: 'Statement already exists' });
    }
    console.error('[submit-statement] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// DELETE /api/submit-statement/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const cloakAddress = req.query.cloakAddress as string;
  if (isNaN(id) || !cloakAddress) {
    return res.status(400).json({ error: 'Missing id or cloakAddress' });
  }

  try {
    const deleted = await deleteStatement(id, cloakAddress);
    if (!deleted) {
      return res.status(404).json({ error: 'Statement not found or already used' });
    }
    return res.json({ status: 'deleted' });
  } catch (err: any) {
    console.error('[submit-statement:delete] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// PUT /api/submit-statement/reorder
router.put('/reorder', async (req: Request, res: Response) => {
  const { cloakAddress, orderedIds } = req.body;
  if (!cloakAddress || !Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'Missing cloakAddress or orderedIds' });
  }

  try {
    await reorderStatements(cloakAddress, orderedIds);
    return res.json({ status: 'reordered' });
  } catch (err: any) {
    console.error('[submit-statement:reorder] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
