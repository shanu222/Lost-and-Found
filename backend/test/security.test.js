// Live location, VPN blocking, staff sign-in and live settings.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { invalidateSettings } from '../src/services/settings.js';
import { TEST_ADMIN, adminSignIn, app, auth, fakeGeocoder, freshPhone, onboardedUser, postFound, shareLocation, signIn } from './helpers.js';

beforeAll(fakeGeocoder);
afterAll(async () => {
  await pool.query('DELETE FROM app_settings');
  invalidateSettings();
  await pool.end();
});

describe('live location', () => {
  it('decides the country from GPS, not from what the user picks', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    // Without a location the country step is refused.
    const no = await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'GB' });
    expect(no.body.error.code).toBe('LOCATION_REQUIRED');
    const loc = await shareLocation(s, 'PK').expect(200);
    expect(loc.body.countryCode).toBe('PK');
    // Asking for GB while physically in PK still gives PK.
    const res = await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'GB' }).expect(200);
    expect(res.body.user.countryCode).toBe('PK');
  });

  it('blocks a VPN: IP country differs from GPS country', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    const res = await shareLocation(s, 'PK', { 'cf-ipcountry': 'US' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VPN_DETECTED');
    const { rows } = await pool.query('SELECT vpn_flagged_at, location_verified_at FROM users WHERE id = $1', [s.user.id]);
    expect(rows[0].vpn_flagged_at).not.toBeNull();
    expect(rows[0].location_verified_at).toBeNull(); // not accepted
    // Same device without the VPN works.
    await shareLocation(s, 'PK', { 'cf-ipcountry': 'PK' }).expect(200);
  });

  it('rejects imprecise locations', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    const res = await s.agent.post('/api/me/location').set(auth(s.token)).send({ lat: 33.7, lng: 73.05, accuracy: 500000 });
    expect(res.body.error.code).toBe('LOCATION_INACCURATE');
  });

  it('posting and claiming need a fresh location inside the user country', async () => {
    const u = await onboardedUser('PK');
    await pool.query("UPDATE users SET location_verified_at = now() - interval '3 days' WHERE id = $1", [u.user.id]);
    const stale = await postFound(u, 'PK');
    expect(stale.status).toBe(428);
    expect(stale.body.error.code).toBe('LOCATION_REQUIRED');
    // Physically in the UAE while the account is in Pakistan.
    await shareLocation(u, 'AE').expect(200);
    const abroad = await postFound(u, 'PK');
    expect(abroad.body.error.code).toBe('LOCATION_COUNTRY_MISMATCH');
    await shareLocation(u, 'PK').expect(200);
    expect((await postFound(u, 'PK')).status).toBe(201);
  });
});

describe('staff sign-in', () => {
  it('signs in with password + emailed code', async () => {
    const a = await adminSignIn();
    expect(a.user.role).toBe('admin');
    await a.agent.get('/api/admin/settings').set(auth(a.token)).expect(200);
  });

  it('never reveals whether an email exists', async () => {
    const r1 = await request(app).post('/api/auth/admin/login').send({ email: 'nobody@example.com', password: 'Whatever#123' });
    const r2 = await request(app).post('/api/auth/admin/login').send({ email: TEST_ADMIN.email, password: 'Wrong#Pass123' });
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r1.body.error.message).toBe(r2.body.error.message);
  });

  it('rejects a wrong 2-step code and an expired ticket', async () => {
    const agent = request.agent(app);
    const first = await agent.post('/api/auth/admin/login').send(TEST_ADMIN).expect(200);
    const wrong = first.body.devCode === '000000' ? '111111' : '000000';
    const bad = await agent.post('/api/auth/admin/verify').send({ ticket: first.body.ticket, code: wrong });
    expect(bad.body.error.code).toBe('OTP_INVALID');
    await agent.post('/api/auth/admin/verify').send({ ticket: 'x'.repeat(40), code: '123456' }).expect(401);
  });

  it('locks the account after 5 wrong passwords', async () => {
    // A separate staff account so the main test admin keeps working.
    const { hashPassword } = await import('../src/lib/password.js');
    await pool.query(
      "INSERT INTO users (email, role, password_hash, display_name) VALUES ('lock@test.foundback.invalid', 'admin', $1, 'Lock test')",
      [await hashPassword('Lock-Test#2026')],
    );
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/admin/login').send({ email: 'lock@test.foundback.invalid', password: 'Nope#12345' }).expect(401);
    }
    const locked = await request(app).post('/api/auth/admin/login').send({ email: 'lock@test.foundback.invalid', password: 'Lock-Test#2026' });
    expect(locked.status).toBe(423);
  });

  it('phone-OTP users cannot use the staff login or the settings API', async () => {
    const u = await onboardedUser('PK');
    await u.agent.get('/api/admin/settings').set(auth(u.token)).expect(403);
  });
});

describe('live settings', () => {
  it('secrets are write-only and never returned in full', async () => {
    const a = await adminSignIn();
    const secret = 're_test_SECRET_value_1234';
    const res = await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { resend_api_key: secret, max_claims_per_day: 5 } }).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET_value');
    const key = res.body.settings.find((x) => x.key === 'resend_api_key');
    expect(key).toMatchObject({ isSet: true, masked: '••••1234', source: 'admin' });
    const { rows } = await pool.query("SELECT secret_enc, value FROM app_settings WHERE key = 'resend_api_key'");
    expect(rows[0].secret_enc).toMatch(/^v1:/); // encrypted at rest
    expect(rows[0].value).toBeNull();
    // Public config exposes limits but never secrets.
    const cfg = await request(app).get('/api/meta/app-config').expect(200);
    expect(cfg.body.config.max_claims_per_day).toBe(5);
    expect(JSON.stringify(cfg.body)).not.toContain('resend');
    // Reset.
    await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { resend_api_key: null, max_claims_per_day: null } }).expect(200);
  });

  it('validates values', async () => {
    const a = await adminSignIn();
    const bad = await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { max_claims_per_day: 9999 } });
    expect(bad.body.error.code).toBe('SETTING_INVALID');
    const unknown = await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { database_url: 'x' } });
    expect(unknown.body.error.code).toBe('SETTING_UNKNOWN');
  });

  it('maintenance mode blocks users but not admins', async () => {
    const a = await adminSignIn();
    const u = await onboardedUser('GB');
    await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { maintenance_mode: true } }).expect(200);
    const blocked = await u.agent.get('/api/found-items').set(auth(u.token));
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('MAINTENANCE');
    await request(app).get('/api/meta/app-config').expect(200);
    await a.agent.get('/api/admin/dashboard').set(auth(a.token)).expect(200);
    await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { maintenance_mode: false } }).expect(200);
    await u.agent.get('/api/found-items').set(auth(u.token)).expect(200);
  });

  it('closing registration stops new sign-ups only', async () => {
    const a = await adminSignIn();
    await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { registration_open: false } }).expect(200);
    const phone = freshPhone('PK');
    const sent = await request(app).post('/api/auth/otp/request').send({ phone }).expect(200);
    const res = await request(app).post('/api/auth/otp/verify').send({ phone, code: sent.body.devCode });
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    await a.agent.patch('/api/admin/settings').set(auth(a.token)).send({ changes: { registration_open: null } }).expect(200);
  });
});
