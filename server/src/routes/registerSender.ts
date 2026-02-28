/**
 * POST /api/keeper/register-sender
 *
 * Registers a cloak (and optionally a sender address) with the keeper store.
 * Called after cloak deployment to ensure the keeper tracks this cloak.
 */

import { Router, type Request, type Response } from 'express';
import { requireKeeperOrUserAuth } from '../middleware/auth.js';
import { getKeeperStore } from '../lib/keeper/store';

const router = Router();

router.post('/', requireKeeperOrUserAuth, async (req: Request, res: Response) => {
  const { cloakAddress, senderAddress } = req.body;

  if (!cloakAddress) {
    return res.status(400).json({ error: 'Missing cloakAddress' });
  }

  try {
    const store = getKeeperStore();

    // Ensure the cloak entry exists in the store
    const existing = await store.get(cloakAddress);
    if (!existing) {
      // Create a minimal entry if cloak isn't registered yet
      await store.add({
        cloakAddress,
        cloakName: '',
        cloakSlug: '',
        tallyMode: 0,
        senderAddresses: senderAddress ? [senderAddress] : [],
      });
    } else if (senderAddress) {
      await store.addSender(cloakAddress, senderAddress);
    }

    return res.json({ status: 'ok' });
  } catch (err: any) {
    console.error('[register-sender] Error:', err?.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
