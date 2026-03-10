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
import { runMigrateV6 } from './lib/db/migrate_v6.js';
import { runMigrateV7 } from './lib/db/migrate_v7.js';
import { runMigrateV8 } from './lib/db/migrate_v8.js';
import { runMigrateV9 } from './lib/db/migrate_v9.js';
import { runMigrateV10 } from './lib/db/migrate_v10.js';
import { runMigrateV11 } from './lib/db/migrate_v11.js';
import { runMigrateV12 } from './lib/db/migrate_v12.js';
import { runMigrateV13 } from './lib/db/migrate_v13.js';
import { extractUser } from './middleware/auth.js';

// Routes
import authRouter from './routes/auth.js';
import deployAccountRouter from './routes/deployAccount.js';
import publishAccountClassRouter from './routes/publishAccountClass.js';
import keeperCronRouter from './routes/keeperCron.js';
import registerSenderRouter from './routes/registerSender.js';
import keeperWarmupRouter from './routes/keeperWarmup.js';
import usersRouter from './routes/users.js';
import categoriesRouter from './routes/categories.js';
import subcategoriesRouter from './routes/subcategories.js';
import duelsRouter from './routes/duels.js';
import commentsRouter from './routes/commentsV2.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust first proxy (Railway reverse proxy) — required for express-rate-limit to read real client IP
app.set('trust proxy', 1);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
    const contentType = req.headers['content-type'] || '';
    const xRequestedWith = req.headers['x-requested-with'];
    const authHeader = req.headers.authorization;

    if (contentType.includes('application/json') || xRequestedWith || authHeader) {
      return next();
    }

    return res.status(403).json({ error: 'Missing required request header' });
  }
  next();
});

// --- HIGH-5: Rate limiting ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/keeper/'),
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', globalLimiter);

const deployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Deployment rate limit exceeded' },
});
app.use('/api/deploy-account', deployLimiter);

const duelCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Duel creation rate limit exceeded' },
});

const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Comment rate limit exceeded' },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Sync rate limit exceeded' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Auth rate limit exceeded' },
});

// --- Extract user identity from JWT on all requests ---
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

// Block clock — returns measured avg block time for accurate duration estimates
app.get('/api/block-clock', async (_req, res) => {
  const { getBlockClock, refreshBlockClock } = await import('./lib/blockClock.js');
  let clock = getBlockClock();
  if (clock.blockNumber === 0) {
    try {
      const { getNode } = await import('./lib/keeper/wallet.js');
      const node = await getNode();
      await refreshBlockClock(node);
      clock = getBlockClock();
    } catch { /* node not ready yet — return defaults */ }
  }
  res.json({
    blockNumber: clock.blockNumber,
    avgBlockTime: clock.avgBlockTime,
    observedAt: clock.observedAt,
  });
});

// Manual trigger for breaking news cron (keeper-auth protected)
app.post('/api/keeper/breaking-news', async (req, res) => {
  const apiSecret = process.env.KEEPER_API_SECRET;
  const authHeader = req.headers.authorization;
  if (!apiSecret || authHeader !== `Bearer ${apiSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { runBreakingNewsCron } = await import('./lib/breakingNews/breakingCron.js');
    const published = await runBreakingNewsCron();
    return res.json({ status: 'ok', published });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message });
  }
});

// API routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/deploy-account', deployAccountRouter);
app.use('/api/publish-account-class', publishAccountClassRouter);
app.use('/api/keeper/cron', keeperCronRouter);
app.use('/api/keeper/register-sender', registerSenderRouter);
app.use('/api/keeper/warmup', keeperWarmupRouter);
app.use('/api/users', usersRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/subcategories', subcategoriesRouter);
app.post('/api/duels', duelCreateLimiter);
app.post('/api/duels/:id/sync', syncLimiter);
app.use('/api/duels', duelsRouter);
app.post('/api/comments', commentLimiter);
app.use('/api/comments', commentsRouter);

// Run V6 + V7 + V8 + V9 migrations then start server
runMigrateV6(pool)
  .then(() => runMigrateV7(pool))
  .then(() => runMigrateV8(pool))
  .then(() => runMigrateV9(pool))
  .then(() => runMigrateV10(pool))
  .then(() => runMigrateV11(pool))
  .then(() => runMigrateV12(pool))
  .then(() => runMigrateV13(pool))
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[Cloakboard Server] Listening on port ${PORT}`);
      // Pre-warm keeper wallet in background
      import('./lib/keeper/wallet.js').then(({ getKeeperWallet }) => {
        getKeeperWallet().catch(() => {});
      }).catch(() => {});

      // Internal cron: snapshot votes + end expired duels every 30s
      const cronInterval = parseInt(process.env.KEEPER_CRON_INTERVAL_MS || '30000', 10);
      const apiSecret = process.env.KEEPER_API_SECRET;
      if (apiSecret) {
        let cronRunning = false;
        setInterval(async () => {
          if (cronRunning) return;
          cronRunning = true;
          try {
            const { takeVoteSnapshots, endExpiredDuels, advanceRecurringPeriods, processPendingOnChainDuels, syncOnChainTallies } = await import('./lib/snapshotCron.js');
            const [snapshots, ended, advanced, pending, tallies] = await Promise.all([
              takeVoteSnapshots(),
              endExpiredDuels(),
              advanceRecurringPeriods(),
              processPendingOnChainDuels(),
              syncOnChainTallies(),
            ]);
            if (snapshots > 0 || ended > 0 || advanced > 0 || pending > 0 || tallies > 0) {
              console.log(`[Cron] snapshots:${snapshots} ended:${ended} advanced:${advanced} pending:${pending} tallies:${tallies}`);
            }
          } catch (err: any) {
            console.warn('[Cron] Failed:', err?.message);
          } finally {
            cronRunning = false;
          }
        }, cronInterval);
        console.log(`[Cloakboard Server] Internal cron enabled (every ${cronInterval / 1000}s)`);
      }

      // Breaking news cron: every 15 minutes
      if (process.env.NEWS_API_KEY) {
        let breakingCronRunning = false;
        setInterval(async () => {
          if (breakingCronRunning) return;
          breakingCronRunning = true;
          try {
            const { runBreakingNewsCron } = await import('./lib/breakingNews/breakingCron.js');
            const published = await runBreakingNewsCron();
            if (published > 0) {
              console.log(`[BreakingCron] Published ${published} breaking news duel(s)`);
            }
          } catch (err: any) {
            console.warn('[BreakingCron] Failed:', err?.message);
          } finally {
            breakingCronRunning = false;
          }
        }, 15 * 60 * 1000); // 15 minutes
        console.log('[Cloakboard Server] Breaking news cron enabled (every 15min)');
      }
    });
  })
  .catch((err) => {
    console.error('[Cloakboard Server] Migration failed:', err?.message);
    // Start anyway -- tables may already exist
    app.listen(PORT, () => {
      console.log(`[Cloakboard Server] Listening on port ${PORT} (migration warning)`);
    });
  });
