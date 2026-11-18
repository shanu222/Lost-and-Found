// Entry point: listen right away, then migrate the database (retrying until it
// is reachable) and start background jobs.
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { readiness } from './lib/readiness.js';
import { startJobs } from './jobs.js';
import { bootstrapAdmin } from './routes/adminAuth.js';

const server = createApp().listen(env.PORT, () => logger.info(`FoundBack API listening on :${env.PORT}`));

function describe(err) {
  const host = (() => {
    try {
      return new URL(env.DATABASE_URL).host;
    } catch {
      return 'invalid DATABASE_URL';
    }
  })();
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return `Database host not found (${host}). Check DATABASE_URL / that the Postgres service exists.`;
  if (err.code === 'ECONNREFUSED') return `Database refused the connection (${host}). Is Postgres running?`;
  if (err.code === '28P01') return 'Database password rejected. Re-copy DATABASE_URL from the Postgres service.';
  if (/timeout/i.test(err.message)) return `Database did not answer in time (${host}).`;
  return err.message;
}

async function boot() {
  for (let attempt = 1; ; attempt++) {
    try {
      readiness.stage = 'migrating';
      await migrate({ log: logger });
      readiness.stage = 'admin';
      await bootstrapAdmin(logger);
      break;
    } catch (err) {
      readiness.error = describe(err);
      logger.error({ attempt, code: err.code }, `[startup] ${readiness.error}`);
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2_000 * attempt)));
    }
  }
  if (env.JOBS_ENABLED) startJobs();
  Object.assign(readiness, { ready: true, stage: 'ready', error: null });
  logger.info('[startup] database ready');
}
boot();

// Graceful shutdown for Railway deploys.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
