import pg from 'pg';
import { env } from '../config/env.js';

// Return DATE/TIMESTAMP columns as JS Dates (default) and NUMERIC as numbers
// for the small numeric columns we use (radius, score, reward).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

// SSL when asked for explicitly or by the URL (e.g. ?sslmode=require). Railway's
// private network (postgres.railway.internal) does not use SSL.
const wantsSsl = env.DATABASE_SSL || /sslmode=(require|verify-ca|verify-full)/.test(env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

// A dropped idle connection (database restart, network blip) must not crash the API.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

/** Run a query. */
export const query = (text, params) => pool.query(text, params);

/** Run `fn(client)` inside a transaction. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
