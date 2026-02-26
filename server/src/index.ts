import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Resolve server root from this file's location (src/index.ts → server/)
const __filename = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(__filename), '..');

dotenv.config({ path: resolve(serverRoot, '.env.local') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: resolve(serverRoot, '.env') });
}

import express from 'express';
import cors from 'cors';
import { pool } from './lib/db/pool.js';
import { runMigrateV2 } from './lib/db/migrate_v2.js';

// Routes
import submitStatementRouter from './routes/submitStatement.js';
import advanceDuelRouter from './routes/advanceDuel.js';
import deployCloakRouter from './routes/deployCloak.js';
import deployAccountRouter from './routes/deployAccount.js';
import publishAccountClassRouter from './routes/publishAccountClass.js';
import keeperCronRouter from './routes/keeperCron.js';
import registerSenderRouter from './routes/registerSender.js';
import duelSyncRouter from './routes/duelSync.js';
import feedRouter from './routes/feed.js';
import commentsRouter from './routes/comments.js';
import starsRouter from './routes/stars.js';
import cloaksRouter from './routes/cloaks.js';
import bansRouter from './routes/bans.js';
import whispersRouter from './routes/whispers.js';
import usersRouter from './routes/users.js';
import voteTimelineRouter from './routes/voteTimeline.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', time: result.rows[0].now });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message });
  }
});

// API routes
app.use('/api/submit-statement', submitStatementRouter);
app.use('/api/advance-duel', advanceDuelRouter);
app.use('/api/deploy-cloak', deployCloakRouter);
app.use('/api/deploy-account', deployAccountRouter);
app.use('/api/publish-account-class', publishAccountClassRouter);
app.use('/api/keeper/cron', keeperCronRouter);
app.use('/api/keeper/register-sender', registerSenderRouter);
app.use('/api/duels/sync', duelSyncRouter);
app.use('/api/duels/feed', feedRouter);
app.use('/api/duels/star', starsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/cloaks', cloaksRouter);
app.use('/api/cloaks/:address/bans', bansRouter);
app.use('/api/whispers', whispersRouter);
app.use('/api/users', usersRouter);
app.use('/api/duels/timeline', voteTimelineRouter);

// Run migrations then start server
runMigrateV2(pool)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[DuelCloak Server] Listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DuelCloak Server] Migration failed:', err?.message);
    // Start anyway — tables may already exist
    app.listen(PORT, () => {
      console.log(`[DuelCloak Server] Listening on port ${PORT} (migration warning)`);
    });
  });
