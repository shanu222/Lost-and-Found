// Recreates the test database schema once per run, then seeds demo data.
import pg from 'pg';

export async function setup() {
  await import('./env.js');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
  const { seed } = await import('../src/db/seed.js');
  await seed();
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
}
