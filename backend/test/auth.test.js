import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { app, auth, firebaseToken, freshEmail, signIn } from './helpers.js';

afterAll(() => pool.end());

describe('Firebase sign-in (Google + email)', () => {
  const post = (body) => request(app).post('/api/auth/firebase').send(body);

  it('creates an account on first Google sign-in and signs in afterwards', async () => {
    const email = freshEmail('PK');
    const first = await signIn(email, 'PK', 'en', { name: 'Ayesha K' });
    expect(first.status).toBe(201);
    expect(first.user.emailVerified).toBe(true);
    expect(first.user.email).toBe(email);
    expect(first.user.displayName).toBe('Ayesha K');
    expect(first.user.language).toBe('en'); // English is the default
    expect(first.user.onboarding.completed).toBe(false);
    const second = await signIn(email, 'PK');
    expect(second.status).toBe(200);
    expect(second.user.id).toBe(first.user.id);
  });

  it('email + password users must verify their email first', async () => {
    const email = freshEmail('GB');
    const unverified = await signIn(email, 'GB', 'en', { provider: 'password', verified: false });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const ok = await signIn(email, 'GB', 'en', { provider: 'password' });
    expect(ok.status).toBe(201);
  });

  it('Google and email/password with the same verified email are one account', async () => {
    const email = freshEmail('AE');
    const viaPassword = await signIn(email, 'AE', 'en', { provider: 'password', uid: 'same-firebase-user' });
    const viaGoogle = await signIn(email, 'AE', 'en', { provider: 'google.com', uid: 'same-firebase-user' });
    expect(viaGoogle.user.id).toBe(viaPassword.user.id);
  });

  it('rejects tokens for another project, expired, forged or from other providers', async () => {
    const email = freshEmail('US');
    expect((await post({ idToken: await firebaseToken({ email, project: 'someone-else' }) })).status).toBe(401);
    expect((await post({ idToken: await firebaseToken({ email, expiresIn: '-10m' }) })).status).toBe(401);
    const good = await firebaseToken({ email });
    const forged = good.slice(0, good.lastIndexOf('.') + 1) + 'A'.repeat(40);
    expect((await post({ idToken: forged })).status).toBe(401);
    const anon = await post({ idToken: await firebaseToken({ email, provider: 'anonymous' }) });
    expect(anon.body.error.code).toBe('PROVIDER_NOT_ALLOWED');
  });

  it('staff accounts cannot skip the password + 2-step login', async () => {
    const res = await signIn(process.env.ADMIN_EMAIL, 'PK');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAFF_LOGIN_REQUIRED');
  });

  it('the old SMS and email-code endpoints are gone', async () => {
    await request(app).post('/api/auth/otp/request').send({ phone: '+923001234567' }).expect(404);
    await request(app).post('/api/auth/email/request').send({ email: 'a@b.co' }).expect(404);
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
    const res = await request(app).post('/api/auth/firebase').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});
