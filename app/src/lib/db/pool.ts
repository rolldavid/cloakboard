/**
 * PostgreSQL Connection Pool Singleton
 *
 * Shared pg.Pool for API routes. Uses DATABASE_URL from environment.
 * Attaches to globalThis to survive Next.js dev mode hot reloads.
 */

import { Pool } from 'pg';

const globalForPg = globalThis as typeof globalThis & { __pgPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.DATABASE_URL?.includes('railway')
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return globalForPg.__pgPool;
}
