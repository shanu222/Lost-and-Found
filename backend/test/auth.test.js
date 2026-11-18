import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { app, auth, freshEmail, signIn } from './helpers.js';

afterAll(() => pool.end());

describe('email code sign-in', () => {
  it('creates an account on first sign-in and signs in afterwards', async () => {
    const email = freshEmail('PK');
    const first = await signIn(email, 'PK');
    expect(first.status).toBe(201);
    expect(first.user.emailVerified).toBe(true);
    expect(first.user.email).toBe(email);
    expect(first.user.language).toBe('en'); // English is the default
    expect(first.user.onboarding.completed).toBe(false);
    const second = await signIn(email.toUpperCase(), 'PK'); // case-insensitive
    expect(second.status).toBe(200);
    expect(second.user.id).toBe(first.user.id);
  });

  it('rejects a wrong code and locks after 5 attempts', async () => {
    const email = freshEmail('GB');
    const sent = await request(app).post('/api/auth/email/request').send({ email }).expect(200);
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/email/verify').send({ email, code: wrong });
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await request(app).post('/api/auth/email/verify').send({ email, code: sent.body.devCode });
    expect(locked.status).toBe(429);
  });

  it('a code only works once and only for its own address', async () => {
    const a = freshEmail('AE');
    const sent = await request(app).post('/api/auth/email/request').send({ email: a }).expect(200);
    const other = await request(app).post('/api/auth/email/verify').send({ email: freshEmail('AE'), code: sent.body.devCode });
    expect(other.body.error.code).toBe('OTP_EXPIRED');
    await request(app).post('/api/auth/email/verify').send({ email: a, code: sent.body.devCode }).expect(201);
    const reuse = await request(app).post('/api/auth/email/verify').send({ email: a, code: sent.body.devCode });
    expect(reuse.status).toBe(400);
  });

  it('throttles code requests per address', async () => {
    const email = freshEmail('US');
    for (let i = 0; i < 3; i++) await request(app).post('/api/auth/email/request').send({ email }).expect(200);
    const res = await request(app).post('/api/auth/email/request').send({ email });
    expect(res.status).toBe(429);
  });

  it('staff accounts cannot skip the password + 2-step login', async () => {
    const email = process.env.ADMIN_EMAIL;
    const sent = await request(app).post('/api/auth/email/request').send({ email }).expect(200);
    const res = await request(app).post('/api/auth/email/verify').send({ email, code: sent.body.devCode });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_LOGIN_REQUIRED');
  });

  it('the old SMS endpoints are gone', async () => {
    await request(app).post('/api/auth/otp/request').send({ phone: '+923001234567' }).expect(404);
  });
});

describe('refresh token rotation', () => {
  it('rotates the refresh cookie and detects re-use', async () => {
    const { agent } = await signIn(freshEmail('PK'), 'PK');
    // Capture the current cookie, then rotate.
    const r1 = await agent.post('/api/auth/refresh').expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    const oldCookie = r1.headers['set-cookie'][0].split(';')[0];
    const r2 = await agent.post('/api/auth/refresh').expect(200);
    expect(r2.body.accessToken).toBeTruthy();

    // Replaying the previous (already rotated) cookie after the grace window kills the family.
    await pool.query("UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL");
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie).expect(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('logout revokes the session', async () => {
    const { agent } = await signIn(freshEmail('PK'), 'PK');
    await agent.post('/api/auth/logout').expect(204);
    await agent.post('/api/auth/refresh').expect(401);
  });

  it('rejects requests without a valid access token', async () => {
    await request(app).get('/api/me').expect(401);
    await request(app).get('/api/me').set(auth('not-a-token')).expect(401);
  });
});

describe('API error format', () => {
  it('returns { error: { code, message, details } } for validation errors', async () => {
    const res = await request(app).post('/api/auth/email/request').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});
