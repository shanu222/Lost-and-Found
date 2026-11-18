// Express application (no listening here, so tests can import it).
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { pool } from './db/pool.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { metaRouter } from './routes/meta.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY); // Railway / Vercel proxy in front

  app.use(
    helmet({
      // The API only serves JSON; lock everything down.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || allowed.includes(origin)) return cb(null, true);
        // Allow Vercel preview deployments when a wildcard like https://*.vercel.app is configured.
        const ok = allowed.some((a) => a.includes('*') && new RegExp(`^${a.replace(/\./g, '\\.').replace('*', '[a-z0-9-]+')}$`).test(origin));
        return cb(null, ok);
      },
      credentials: true,
    }),
  );

  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/meta', metaRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
