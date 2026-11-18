import pg from 'pg';
import { env } from '../config/env.js';

// Return DATE/TIMESTAMP columns as JS Dates (default) and NUMERIC as numbers
// for the small numeric columns we use (radius, score, reward).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

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
