// Entry point: run migrations, then start the HTTP server.
import { env } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

await migrate({ log: logger });
const server = createApp().listen(env.PORT, () => logger.info(`FoundBack API listening on :${env.PORT}`));

// Graceful shutdown for Railway deploys.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
