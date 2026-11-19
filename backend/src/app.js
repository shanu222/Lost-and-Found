// Express application (no listening here, so tests can import it).
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { readiness } from './lib/readiness.js';
import { pool } from './db/pool.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { metaRouter } from './routes/meta.js';
import { foundItemsRouter } from './routes/foundItems.js';
import { alertsRouter, lostReportsRouter, travelRouter } from './routes/lostReports.js';
import { claimsRouter, createClaim, listItemClaims } from './routes/claims.js';
import { conversationsRouter } from './routes/conversations.js';
import { adminRouter } from './routes/admin.js';
import { miscRouter } from './routes/misc.js';
import { requireAuth, requireOnboarded } from './middleware/auth.js';
import { upload } from './lib/upload.js';
import { adminAuthRouter } from './routes/adminAuth.js';
import { maintenanceGate } from './middleware/maintenance.js';

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

  // Bare API address: say what this is instead of a 404.
  app.get('/', (_req, res) => res.json({ service: 'FoundBack API', health: '/api/health', app: env.APP_URL || null }));

  // Liveness (Railway health check): 200 whenever the process is up, so the
  // deployment goes live and this page can say what is still missing.
  app.get('/api/health', async (_req, res) => {
    if (!readiness.ready && !isTest) {
      return res.json({ ok: false, live: true, stage: readiness.stage, error: readiness.error });
    }
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, live: true });
    } catch (err) {
      res.json({ ok: false, live: true, stage: 'database', error: err.message });
    }
  });
  // Readiness: 503 until the database is migrated and reachable.
  app.get('/api/ready', async (_req, res) => {
    if (!readiness.ready && !isTest) return res.status(503).json({ ready: false, stage: readiness.stage, error: readiness.error });
    try {
      await pool.query('SELECT 1');
      res.json({ ready: true });
    } catch (err) {
      res.status(503).json({ ready: false, stage: 'database', error: err.message });
    }
  });
  // Until the database is migrated, everything else waits.
  app.use('/api', (_req, res, next) =>
    readiness.ready || isTest ? next() : res.status(503).json({ error: { code: 'STARTING', message: 'The service is starting. Please try again in a moment.' } }),
  );

  app.use('/api', apiLimiter);
  app.use('/api', maintenanceGate);
  app.use('/api/auth/admin', adminAuthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me/travel', travelRouter);
  app.use('/api/me', meRouter);
  app.use('/api/meta', metaRouter);
  // Claims are created/reviewed under the item they belong to.
  app.post('/api/found-items/:id/claims', requireAuth, requireOnboarded, upload.any(), createClaim);
  app.get('/api/found-items/:id/claims', requireAuth, requireOnboarded, listItemClaims);
  app.use('/api/found-items', foundItemsRouter);
  app.use('/api/lost-reports', lostReportsRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/claims', claimsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', miscRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
