import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Resolve server root from this file's location (src/index.ts -> server/)
const __filename = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(__filename), '..');

dotenv.config({ path: resolve(serverRoot, '.env.local') });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: resolve(serverRoot, '.env') });
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pool } from './lib/db/pool.js';
import { runMigrateV2 } from './lib/db/migrate_v2.js';
import { runMigrateV3 } from './lib/db/migrate_v3.js';
import { runMigrateV4 } from './lib/db/migrate_v4.js';
import { runMigrateV5 } from './lib/db/migrate_v5.js';
import { extractUser } from './middleware/auth.js';

// Routes
import authRouter from './routes/auth.js';
import submitStatementRouter from './routes/submitStatement.js';
import advanceDuelRouter from './routes/advanceDuel.js';
import deployCloakRouter from './routes/deployCloak.js';
import deployAccountRouter from './routes/deployAccount.js';
import publishAccountClassRouter from './routes/publishAccountClass.js';
import keeperCronRouter from './routes/keeperCron.js';
import registerSenderRouter from './routes/registerSender.js';
import keeperWarmupRouter from './routes/keeperWarmup.js';
import duelSyncRouter from './routes/duelSync.js';
import feedRouter from './routes/feed.js';
import commentsRouter from './routes/comments.js';
import starsRouter from './routes/stars.js';
import cloaksRouter from './routes/cloaks.js';
import joinsRouter from './routes/joins.js';
import bansRouter from './routes/bans.js';
import usersRouter from './routes/users.js';
import voteTimelineRouter from './routes/voteTimeline.js';
import duelVotesRouter from './routes/duelVotes.js';
import councilRouter from './routes/council.js';

const app = express();
const PORT = process.env.PORT || 3001;

// --- HIGH-1: Restrict CORS to allowed origins ---
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv.split(',').map((o) => o.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-address', 'x-user-name', 'X-Requested-With'],
  credentials: true,
}));

// --- MEDIUM-5: Security headers via helmet ---
app.use(helmet({
  // Disable CSP for now (Aztec WASM loading needs special config)
  contentSecurityPolicy: false,
  // Allow cross-origin for Aztec WASM
  crossOriginEmbedderPolicy: false,
}));

// --- LOW-3: Explicit JSON body size limit ---
app.use(express.json({ limit: '100kb' }));

// --- MEDIUM-4: CSRF protection via custom header check for state-changing requests ---
app.use((req, res, next) => {
  // Only check POST/PUT/DELETE (state-changing)
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // Allow if Content-Type is application/json (can't be sent by HTML forms)
    // or if X-Requested-With header is present (can't be set by forms)
    const contentType = req.headers['content-type'] || '';
    const xRequestedWith = req.headers['x-requested-with'];
    const authHeader = req.headers.authorization;

    // If request has JSON content-type, X-Requested-With header, or auth header, allow it
    // These cannot be set by simple form submissions (CSRF vector)
    if (contentType.includes('application/json') || xRequestedWith || authHeader) {
      return next();
    }

    // Block form-based requests without the custom header
    return res.status(403).json({ error: 'Missing required request header' });
  }
  next();
});

// --- HIGH-5: Rate limiting ---
// Global rate limit: 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', globalLimiter);

// Strict rate limit for deployment endpoints: 5 requests per hour per IP
const deployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Deployment rate limit exceeded' },
});
app.use('/api/deploy-cloak', deployLimiter);
app.use('/api/deploy-account', deployLimiter);
// publish-account-class is idempotent (returns early if already published),
// called on every login — global rate limit (100/15min) is sufficient.

// --- Extract user identity from JWT or headers on all requests ---
app.use(extractUser);

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', time: result.rows[0].now });
  } catch {
    res.status(500).json({ status: 'error', error: 'Database connection failed' });
  }
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/submit-statement', submitStatementRouter);
app.use('/api/advance-duel', advanceDuelRouter);
app.use('/api/deploy-cloak', deployCloakRouter);
app.use('/api/deploy-account', deployAccountRouter);
app.use('/api/publish-account-class', publishAccountClassRouter);
app.use('/api/keeper/cron', keeperCronRouter);
app.use('/api/keeper/register-sender', registerSenderRouter);
app.use('/api/keeper/warmup', keeperWarmupRouter);
app.use('/api/duels/sync', duelSyncRouter);
app.use('/api/duels/feed', feedRouter);
app.use('/api/duels/star', starsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/cloaks/join', joinsRouter);
app.use('/api/cloaks', cloaksRouter);
app.use('/api/cloaks/:address/bans', bansRouter);
app.use('/api/users', usersRouter);
app.use('/api/duels/timeline', voteTimelineRouter);
app.use('/api/duels/vote', duelVotesRouter);
app.use('/api/cloaks/:address/council', councilRouter);

// Run migrations then start server
runMigrateV2(pool)
  .then(() => runMigrateV3(pool))
  .then(() => runMigrateV4(pool))
  .then(() => runMigrateV5(pool))
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[DuelCloak Server] Listening on port ${PORT}`);
      // Pre-warm keeper wallet in background (saves 5-10s on first deploy)
      import('./lib/keeper/wallet.js').then(({ getKeeperWallet }) => {
        getKeeperWallet().catch(() => {});
      }).catch(() => {});

      // Internal cron: auto-advance duels + sync votes every 60s
      const cronInterval = parseInt(process.env.KEEPER_CRON_INTERVAL_MS || '60000', 10);
      const apiSecret = process.env.KEEPER_API_SECRET;
      if (apiSecret) {
        let cronRunning = false;
        setInterval(async () => {
          if (cronRunning) return;
          cronRunning = true;
          try {
            const resp = await fetch(`http://localhost:${PORT}/api/keeper/cron`, {
              headers: { Authorization: `Bearer ${apiSecret}` },
            });
            const data = await resp.json();
            if (data.results?.length > 0) {
              console.log(`[Cron] ${data.results.length} action(s):`, data.results.map((r: any) => `${r.action}:${r.status}`).join(', '));
            }
          } catch (err: any) {
            console.warn('[Cron] Failed:', err?.message);
          } finally {
            cronRunning = false;
          }
        }, cronInterval);
        console.log(`[DuelCloak Server] Internal cron enabled (every ${cronInterval / 1000}s)`);
      }
    });
  })
  .catch((err) => {
    console.error('[DuelCloak Server] Migration failed:', err?.message);
    // Start anyway -- tables may already exist
    app.listen(PORT, () => {
      console.log(`[DuelCloak Server] Listening on port ${PORT} (migration warning)`);
    });
  });
