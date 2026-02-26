import { pool } from './pool.js';

export interface DuelScheduleRow {
  cloak_address: string;
  next_duel_at: string | null;
  duel_interval_seconds: number;
  auto_advance: boolean;
  created_at: string;
  updated_at: string;
}

export async function upsertDuelSchedule(
  cloakAddress: string,
  duelIntervalSeconds: number,
  nextDuelAt?: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO duel_schedule (cloak_address, duel_interval_seconds, next_duel_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (cloak_address) DO UPDATE
     SET duel_interval_seconds = $2, next_duel_at = $3, updated_at = NOW()`,
    [cloakAddress, duelIntervalSeconds, nextDuelAt || null],
  );
}

export async function getDuelSchedule(
  cloakAddress: string,
): Promise<DuelScheduleRow | null> {
  const result = await pool.query(
    `SELECT * FROM duel_schedule WHERE cloak_address = $1`,
    [cloakAddress],
  );
  return result.rows[0] || null;
}

export async function getDueCloaks(): Promise<DuelScheduleRow[]> {
  const result = await pool.query(
    `SELECT * FROM duel_schedule
     WHERE auto_advance = TRUE AND next_duel_at <= NOW()`,
  );
  return result.rows;
}

export async function advanceSchedule(cloakAddress: string): Promise<void> {
  await pool.query(
    `UPDATE duel_schedule
     SET next_duel_at = NOW() + (duel_interval_seconds || ' seconds')::interval,
         updated_at = NOW()
     WHERE cloak_address = $1`,
    [cloakAddress],
  );
}
