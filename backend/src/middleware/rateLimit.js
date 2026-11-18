// Rate limiters (in-memory store; fine for a single Railway instance — use a
// Redis store from `rate-limit-redis` when scaling horizontally).
import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } });

const make = (windowMs, limit) =>
  rateLimit({ windowMs, limit: isTest ? 10_000 : limit, standardHeaders: 'draft-8', legacyHeaders: false, handler });

export const apiLimiter = make(15 * 60 * 1000, 600);
export const authLimiter = make(15 * 60 * 1000, 30);
export const otpLimiter = make(60 * 60 * 1000, 10);
export const geocodeLimiter = make(60 * 1000, 30);
