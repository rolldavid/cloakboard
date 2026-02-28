/**
 * Council management routes (mounted at /api/cloaks/:address/council).
 *
 * POST   /invite            — Invite a username to the council
 * POST   /claim             — Claim a pending invite
 * POST   /decline           — Decline a pending invite
 * GET    /invites           — List pending invites
 * POST   /propose-removal   — Propose removing a council member
 * POST   /removal/:id/vote  — Vote on a removal proposal
 * GET    /removals          — List active/resolved removal proposals
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../lib/db/pool.js';

const router = Router({ mergeParams: true });

function getUser(req: Request) {
  return {
    address: req.headers['x-user-address'] as string,
    name: req.headers['x-user-name'] as string,
  };
}

async function getCouncilRole(cloakAddress: string, username: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT role FROM council_members WHERE cloak_address = $1 AND LOWER(username) = LOWER($2)`,
    [cloakAddress, username],
  );
  return result.rows[0]?.role ?? null;
}

async function getCouncilCount(cloakAddress: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM council_members WHERE cloak_address = $1`,
    [cloakAddress],
  );
  return result.rows[0]?.cnt ?? 0;
}

// POST /invite — invite a username
router.post('/invite', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.name) return res.status(401).json({ error: 'Authentication required' });

  const cloakAddress = req.params.address;
  const { username } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Missing username' });
  }

  try {
    const role = await getCouncilRole(cloakAddress, user.name);
    if (role === null || role < 2) {
      return res.status(403).json({ error: 'Council role required' });
    }

    // Check if already on council
    const existingMember = await pool.query(
      `SELECT 1 FROM council_members WHERE cloak_address = $1 AND LOWER(username) = LOWER($2)`,
      [cloakAddress, username.trim()],
    );
    if ((existingMember.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: 'User is already a council member' });
    }

    // Check if already invited (unclaimed)
    const existingInvite = await pool.query(
      `SELECT 1 FROM council_invites WHERE cloak_address = $1 AND LOWER(username) = LOWER($2) AND claimed_by IS NULL`,
      [cloakAddress, username.trim()],
    );
    if ((existingInvite.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: 'User already has a pending invite' });
    }

    await pool.query(
      `INSERT INTO council_invites (cloak_address, username, invited_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (cloak_address, username) DO UPDATE SET
         invited_by = $3, claimed_by = NULL, claimed_at = NULL, created_at = NOW()`,
      [cloakAddress, username.trim(), user.address],
    );

    return res.json({ invited: true });
  } catch (err: any) {
    console.error('[council:invite] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /claim — claim a pending invite
router.post('/claim', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address || !user.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const cloakAddress = req.params.address;

  try {
    // Find matching unclaimed invite
    const invite = await pool.query(
      `SELECT id FROM council_invites
       WHERE cloak_address = $1 AND LOWER(username) = LOWER($2) AND claimed_by IS NULL`,
      [cloakAddress, user.name],
    );

    if ((invite.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'No pending invite found' });
    }

    // Mark invite as claimed
    await pool.query(
      `UPDATE council_invites SET claimed_by = $1, claimed_at = NOW() WHERE id = $2`,
      [user.address, invite.rows[0].id],
    );

    // Add to council
    await pool.query(
      `INSERT INTO council_members (cloak_address, user_address, username, role)
       VALUES ($1, $2, $3, 2)
       ON CONFLICT (cloak_address, user_address) DO NOTHING`,
      [cloakAddress, user.address, user.name],
    );

    return res.json({ claimed: true });
  } catch (err: any) {
    console.error('[council:claim] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /decline — decline a pending invite
router.post('/decline', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.address || !user.name) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const cloakAddress = req.params.address;

  try {
    const result = await pool.query(
      `DELETE FROM council_invites
       WHERE cloak_address = $1 AND LOWER(username) = LOWER($2) AND claimed_by IS NULL`,
      [cloakAddress, user.name],
    );

    if ((result.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'No pending invite found' });
    }

    return res.json({ declined: true });
  } catch (err: any) {
    console.error('[council:decline] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /invites — list pending invites
router.get('/invites', async (req: Request, res: Response) => {
  const cloakAddress = req.params.address;

  try {
    const result = await pool.query(
      `SELECT id, username, invited_by, created_at
       FROM council_invites
       WHERE cloak_address = $1 AND claimed_by IS NULL
       ORDER BY created_at DESC`,
      [cloakAddress],
    );

    return res.json({
      invites: result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        invitedBy: row.invited_by,
        createdAt: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[council:invites] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /propose-removal — propose removing a council member
router.post('/propose-removal', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.name) return res.status(401).json({ error: 'Authentication required' });

  const cloakAddress = req.params.address;
  const { targetUsername } = req.body;
  if (!targetUsername || typeof targetUsername !== 'string') {
    return res.status(400).json({ error: 'Missing targetUsername' });
  }

  try {
    // Check caller is council
    const callerRole = await getCouncilRole(cloakAddress, user.name);
    if (callerRole === null || callerRole < 2) {
      return res.status(403).json({ error: 'Council role required' });
    }

    // Find target member
    const targetResult = await pool.query(
      `SELECT user_address, username, role FROM council_members
       WHERE cloak_address = $1 AND LOWER(username) = LOWER($2)`,
      [cloakAddress, targetUsername.trim()],
    );

    if ((targetResult.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'Target is not a council member' });
    }

    const target = targetResult.rows[0];

    // Cannot remove self
    if (target.username.toLowerCase() === user.name.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot propose removing yourself' });
    }

    // Creator is immune
    if (target.role >= 3) {
      return res.status(403).json({ error: 'Cannot propose removing the creator' });
    }

    // Check for existing active proposal
    const existing = await pool.query(
      `SELECT 1 FROM council_removals
       WHERE cloak_address = $1 AND LOWER(target_username) = LOWER($2) AND resolved = FALSE`,
      [cloakAddress, targetUsername.trim()],
    );
    if ((existing.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: 'An active removal proposal already exists for this member' });
    }

    // Create proposal (48h window)
    const insertResult = await pool.query(
      `INSERT INTO council_removals (cloak_address, target_address, target_username, proposed_by, proposed_by_username, ends_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '48 hours')
       RETURNING id`,
      [cloakAddress, target.user_address, target.username, user.address, user.name],
    );

    const removalId = insertResult.rows[0].id;

    // Auto-cast proposer's vote as "remove" (keyed by username)
    await pool.query(
      `INSERT INTO council_removal_votes (removal_id, voter_username, vote)
       VALUES ($1, $2, TRUE)`,
      [removalId, user.name],
    );

    return res.json({ proposed: true, removalId });
  } catch (err: any) {
    console.error('[council:propose-removal] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// POST /removal/:id/vote — vote on a removal proposal
router.post('/removal/:id/vote', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.name) return res.status(401).json({ error: 'Authentication required' });

  const cloakAddress = req.params.address;
  const removalId = parseInt(req.params.id, 10);
  const { vote } = req.body;

  if (typeof vote !== 'boolean') {
    return res.status(400).json({ error: 'Missing vote (boolean)' });
  }

  try {
    // Check caller is council
    const callerRole = await getCouncilRole(cloakAddress, user.name);
    if (callerRole === null || callerRole < 2) {
      return res.status(403).json({ error: 'Council role required' });
    }

    // Check proposal exists, is active, and belongs to this cloak
    const proposal = await pool.query(
      `SELECT id, resolved, ends_at FROM council_removals
       WHERE id = $1 AND cloak_address = $2`,
      [removalId, cloakAddress],
    );

    if ((proposal.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: 'Removal proposal not found' });
    }

    const prop = proposal.rows[0];
    if (prop.resolved) {
      return res.status(400).json({ error: 'Proposal already resolved' });
    }
    if (new Date(prop.ends_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Voting period has ended' });
    }

    // Check if already voted (keyed by username)
    const existingVote = await pool.query(
      `SELECT 1 FROM council_removal_votes WHERE removal_id = $1 AND LOWER(voter_username) = LOWER($2)`,
      [removalId, user.name],
    );
    if ((existingVote.rowCount ?? 0) > 0) {
      return res.status(409).json({ error: 'Already voted on this proposal' });
    }

    await pool.query(
      `INSERT INTO council_removal_votes (removal_id, voter_username, vote)
       VALUES ($1, $2, $3)`,
      [removalId, user.name, vote],
    );

    return res.json({ voted: true });
  } catch (err: any) {
    console.error('[council:removal-vote] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// GET /removals — list removal proposals
router.get('/removals', async (req: Request, res: Response) => {
  const cloakAddress = req.params.address;
  const viewer = req.query.viewer as string | undefined;

  try {
    const totalMembers = await getCouncilCount(cloakAddress);

    const result = await pool.query(
      `SELECT r.id, r.target_address, r.target_username, r.proposed_by, r.proposed_by_username, r.created_at, r.ends_at, r.resolved, r.outcome,
              COALESCE(SUM(CASE WHEN v.vote = TRUE THEN 1 ELSE 0 END), 0)::int AS votes_for,
              COALESCE(SUM(CASE WHEN v.vote = FALSE THEN 1 ELSE 0 END), 0)::int AS votes_against
       FROM council_removals r
       LEFT JOIN council_removal_votes v ON v.removal_id = r.id
       WHERE r.cloak_address = $1
       GROUP BY r.id
       ORDER BY r.resolved ASC, r.created_at DESC`,
      [cloakAddress],
    );

    // Get viewer's votes if provided (viewer is now a username)
    let myVotes: Record<number, boolean> = {};
    if (viewer) {
      const voteResult = await pool.query(
        `SELECT v.removal_id, v.vote FROM council_removal_votes v
         JOIN council_removals r ON r.id = v.removal_id
         WHERE r.cloak_address = $1 AND LOWER(v.voter_username) = LOWER($2)`,
        [cloakAddress, viewer],
      );
      for (const row of voteResult.rows) {
        myVotes[row.removal_id] = row.vote;
      }
    }

    return res.json({
      removals: result.rows.map((row) => ({
        id: row.id,
        targetUsername: row.target_username,
        targetAddress: row.target_address,
        proposedBy: row.proposed_by_username || row.proposed_by.slice(0, 10) + '...',
        createdAt: row.created_at,
        endsAt: row.ends_at,
        resolved: row.resolved,
        outcome: row.outcome,
        votesFor: row.votes_for,
        votesAgainst: row.votes_against,
        myVote: viewer && row.id in myVotes ? myVotes[row.id] : null,
        totalMembers,
      })),
    });
  } catch (err: any) {
    console.error('[council:removals] Error:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

export default router;
