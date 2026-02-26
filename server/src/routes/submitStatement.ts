/**
 * POST /api/submit-statement
 *
 * Statement text → Postgres (no on-chain, no keeper).
 * On-chain hash submission happens later when advance-duel picks it.
 */

import { Router, type Request, type Response } from 'express';
import { insertStatement } from '../lib/db/statements';

const router = Router();

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

export default router;
