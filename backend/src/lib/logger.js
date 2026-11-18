import pino from 'pino';
import { env, isTest } from '../config/env.js';

// Redact anything that could carry secrets or personal data.
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.phone', '*.code', '*.idToken'],
    censor: '[redacted]',
  },
});
