import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { signCityRef } from '../src/services/users.js';
import { auth, fakeGeocoder, freshPhone, shareLocation, signIn } from './helpers.js';

beforeAll(fakeGeocoder);
afterAll(() => pool.end());

const cityId = async (cc, name) =>
  Number((await pool.query('SELECT id FROM cities WHERE country_code = $1 AND name = $2', [cc, name])).rows[0].id);

async function onboard(cc = 'PK', city = 'Islamabad') {
  const s = await signIn(freshPhone(cc), cc);
  await shareLocation(s, cc).expect(200);
  await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: cc }).expect(200);
  await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityId: await cityId(cc, city) }).expect(200);
  await s.agent.patch('/api/me/settings').set(auth(s.token)).send({ displayName: 'Test User' }).expect(200);
  const done = await s.agent.post('/api/me/onboarding/complete').set(auth(s.token)).expect(200);
  return { ...s, user: done.body.user };
}

describe('onboarding', () => {
  it('derives currency, units, time zone and locale from the country', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    const res = await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'pk', timezone: 'Asia/Karachi' }).expect(200);
    expect(res.body.user).toMatchObject({ countryCode: 'PK', currency: 'PKR', units: 'km', timezone: 'Asia/Karachi', locale: 'en-PK', textDir: 'ltr' });
    const gb = await signIn(freshPhone('GB'), 'GB');
    await shareLocation(gb, 'GB').expect(200);
    const r2 = await gb.agent.post('/api/me/onboarding/country').set(auth(gb.token)).send({ countryCode: 'GB', timezone: 'Asia/Tokyo' }).expect(200);
    expect(r2.body.user).toMatchObject({ currency: 'GBP', units: 'mi', timezone: 'Europe/London' });
  });

  it('rejects a city from another country', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'PK' }).expect(200);
    const res = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityId: await cityId('AE', 'Dubai') });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COUNTRY_MISMATCH');
  });

  it('accepts a signed Nominatim city only for the user country, and rejects tampering', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'PK' }).expect(200);
    const search = await s.agent.get('/api/meta/cities?q=Murree').set(auth(s.token)).expect(200);
    const murree = search.body.cities.find((c) => c.name === 'Murree');
    expect(murree.ref).toBeTruthy();
    const ok = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityRef: murree.ref }).expect(200);
    expect(ok.body.user.city.name).toBe('Murree');

    const forged = murree.ref.replace(/^.{5}/, 'AAAAA');
    const bad = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityRef: forged });
    expect(bad.body.error.code).toBe('CITY_INVALID');

    const foreign = signCityRef({ name: 'Dubai', region: null, lat: 25.2, lng: 55.27, externalId: 'osm:x:1', countryCode: 'AE' });
    const res = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityRef: foreign });
    expect(res.body.error.code).toBe('COUNTRY_MISMATCH');
  });

  it('rejects a home pin outside the country', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'PK' }).expect(200);
    const id = await cityId('PK', 'Islamabad');
    const out = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityId: id, home: { lat: 25.2, lng: 55.27 } });
    expect(out.body.error.code).toBe('LOCATION_OUTSIDE_COUNTRY');
    const ok = await s.agent.post('/api/me/onboarding/city').set(auth(s.token)).send({ cityId: id, home: { lat: 33.7, lng: 73.05, radiusKm: 3 } }).expect(200);
    expect(ok.body.user.home).toEqual({ lat: 33.7, lng: 73.05, radiusKm: 3 });
  });

  it('cannot complete onboarding with missing steps', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    const res = await s.agent.post('/api/me/onboarding/complete').set(auth(s.token)).expect(400);
    expect(res.body.error.details.missing).toEqual(expect.arrayContaining(['country', 'city', 'profile']));
  });

  it('completes onboarding', async () => {
    const { user } = await onboard('AE', 'Dubai');
    expect(user.onboarding.completed).toBe(true);
    expect(user.trust.level).toBe('phone_verified');
  });

  it('verifies a phone only from the user country', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    await s.agent.post('/api/me/onboarding/country').set(auth(s.token)).send({ countryCode: 'PK' }).expect(200);
    const foreign = await s.agent.post('/api/me/phone/request').set(auth(s.token)).send({ phone: freshPhone('AE') });
    expect(foreign.body.error.code).toBe('PHONE_COUNTRY_MISMATCH');
    const taken = await s.agent.post('/api/me/phone/request').set(auth(s.token)).send({ phone: '+923001234567' });
    expect(taken.body.error.code).toBe('PHONE_IN_USE');
    const phone = freshPhone('PK');
    const sent = await s.agent.post('/api/me/phone/request').set(auth(s.token)).send({ phone }).expect(200);
    const ok = await s.agent.post('/api/me/phone/verify').set(auth(s.token)).send({ phone, code: sent.body.devCode }).expect(200);
    expect(ok.body.user.phone.masked).toMatch(/^\+92 •••• \d{4}$/);
  });
});

describe('language', () => {
  it('only changes when the user asks, and switches text direction', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    expect(s.user.language).toBe('en');
    const ur = await s.agent.patch('/api/me/settings').set(auth(s.token)).send({ language: 'ur' }).expect(200);
    expect(ur.body.user).toMatchObject({ language: 'ur', textDir: 'rtl' });
    const bad = await s.agent.patch('/api/me/settings').set(auth(s.token)).send({ language: 'xx' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects contact details in the display name', async () => {
    const s = await signIn(freshPhone('PK'), 'PK');
    await shareLocation(s, 'PK').expect(200);
    const res = await s.agent.patch('/api/me/settings').set(auth(s.token)).send({ displayName: 'Ali 0300 1234567' }).expect(400);
    expect(res.body.error.code).toBe('DISPLAY_NAME_INVALID');
  });
});

describe('changing country', () => {
  it('needs confirmation, resets location + phone and enforces a 30-day cooldown', async () => {
    const s = await onboard('PK', 'Lahore');
    await s.agent.post('/api/me/country').set(auth(s.token)).send({ countryCode: 'AE' }).expect(400); // no confirm
    await shareLocation(s, 'AE').expect(200);
    const moved = await s.agent.post('/api/me/country').set(auth(s.token)).send({ countryCode: 'AE', confirm: true }).expect(200);
    expect(moved.body.user).toMatchObject({ countryCode: 'AE', currency: 'AED', city: null });
    expect(moved.body.user.onboarding.completed).toBe(false);
    expect(moved.body.user.trust.phoneVerified).toBe(false);

    // Finish onboarding again in the new country, then try to move again.
    await pool.query('UPDATE users SET onboarding_completed_at = now() WHERE id = $1', [s.user.id]);
    await shareLocation(s, 'GB').expect(200);
    const again = await s.agent.post('/api/me/country').set(auth(s.token)).send({ countryCode: 'GB', confirm: true }).expect(403);
    expect(again.body.error.code).toBe('COUNTRY_COOLDOWN');
  });
});

describe('account', () => {
  it('exports data and deletes the account', async () => {
    const s = await onboard('PK', 'Islamabad');
    const exp = await s.agent.get('/api/me/export').set(auth(s.token)).expect(200);
    expect(exp.body.profile.phone).toMatch(/^\+92/);
    await s.agent.delete('/api/me').set(auth(s.token)).send({ confirm: 'DELETE' }).expect(204);
    await s.agent.get('/api/me').set(auth(s.token)).expect(401);
    const { rows } = await pool.query('SELECT phone_enc, display_name, status FROM users WHERE id = $1', [s.user.id]);
    expect(rows[0]).toEqual({ phone_enc: null, display_name: null, status: 'deleted' });
  });
});

export { onboard };
