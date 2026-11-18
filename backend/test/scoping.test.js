// Country scoping: a user only ever sees data for their own country,
// whatever they put in the request.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { app, auth, signIn } from './helpers.js';

afterAll(() => pool.end());

describe('country scoping', () => {
  it('counters only include the requester country', async () => {
    const pk = await signIn('+923001234567', 'PK'); // seeded, onboarded in PK
    const res = await pk.agent.get('/api/meta/stats?country=AE').set(auth(pk.token)).expect(200);
    const { rows } = await pool.query(
      "SELECT count(*) FILTER (WHERE status='returned')::int AS returned FROM found_items WHERE country_code = 'PK'",
    );
    expect(res.body.countryCode).toBe('PK');
    expect(res.body.returned).toBe(rows[0].returned);
  });

  it('city search ignores any country in the query string', async () => {
    const ae = await signIn('+971501234567', 'AE');
    const res = await ae.agent.get('/api/meta/cities?q=&country=PK&countryCode=PK').set(auth(ae.token)).expect(200);
    const names = res.body.cities.map((c) => c.name);
    expect(names).toContain('Dubai');
    expect(names).not.toContain('Karachi');
  });

  it('onboarding country cannot be changed once onboarded except through Settings', async () => {
    const us = await signIn('+12125550147', 'US');
    const res = await us.agent.post('/api/me/onboarding/country').set(auth(us.token)).send({ countryCode: 'PK' }).expect(403);
    expect(res.body.error.code).toBe('ONBOARDING_DONE');
  });
});

describe('meta', () => {
  it('suggests a country from CDN headers, then the browser locale', async () => {
    const a = await request(app).get('/api/meta/suggest-country').set('cf-ipcountry', 'AE').expect(200);
    expect(a.body).toEqual({ countryCode: 'AE', source: 'ip' });
    const b = await request(app).get('/api/meta/suggest-country?locale=ur-PK').expect(200);
    expect(b.body).toEqual({ countryCode: 'PK', source: 'locale' });
    const c = await request(app).get('/api/meta/suggest-country?locale=en').expect(200);
    expect(c.body.countryCode).toBeNull();
  });

  it('lists every ISO country with flags and suggested languages', async () => {
    const res = await request(app).get('/api/meta/countries').expect(200);
    expect(res.body.countries.length).toBeGreaterThan(240);
    expect(res.body.countries.find((c) => c.code === 'PK')).toMatchObject({ flag: '🇵🇰', languages: ['ur'], dialCodes: ['92'] });
  });

  it('serves country guidance in the requested language with English fallback', async () => {
    const ur = await request(app).get('/api/meta/countries/PK?lang=ur').expect(200);
    expect(ur.body.country.guidance.ids).toMatch(/نادرا/);
    expect(ur.body.country.nationalIdName).toBe('CNIC');
    const fr = await request(app).get('/api/meta/countries/GB?lang=fr').expect(200);
    expect(fr.body.country.guidance.ids).toMatch(/Passport Office/);
  });
});
