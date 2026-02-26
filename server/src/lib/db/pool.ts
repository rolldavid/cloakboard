import pg from 'pg';

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | null = null;

/** Lazily create the pool so process.env.DATABASE_URL is available (set by dotenv in index.ts). */
export const pool = new Proxy({} as InstanceType<typeof Pool>, {
  get(_target, prop, receiver) {
    if (!_pool) {
      _pool = new Pool({ connectionString: process.env.DATABASE_URL });
      _pool.on('error', (err) => {
        console.error('[DB Pool] Unexpected error on idle client:', err);
      });
    }
    const value = (_pool as any)[prop];
    return typeof value === 'function' ? value.bind(_pool) : value;
  },
});
