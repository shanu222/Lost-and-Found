import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();

/** Signs in with phone OTP and returns { agent, token, user }. */
export async function signIn(phone, countryCode, language = 'en') {
  const agent = request.agent(app);
  const sent = await agent.post('/api/auth/otp/request').send({ phone, countryCode, language }).expect(200);
  const res = await agent.post('/api/auth/otp/verify').send({ phone, countryCode, code: sent.body.devCode, language });
  if (res.status >= 300) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, token: res.body.accessToken, user: res.body.user, status: res.status };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

let counter = 0;
/** A fresh, valid, unique phone number for the given country. */
export function freshPhone(cc) {
  counter += 1;
  const n = String(1000000 + counter * 37 + Math.floor(Math.random() * 30)).slice(-7);
  return { PK: `+92300${n}`, GB: `+447700${n.slice(-6)}`, AE: `+97150${n}`, US: `+1212555${n.slice(-4)}` }[cc];
}

// ---------------------------------------------------------------------------
// Stage 2+ helpers
// ---------------------------------------------------------------------------
import sharp from 'sharp';
import { pool } from '../src/db/pool.js';
import { setGeocoderFetch } from '../src/services/geocode.js';

const BOXES = { PK: [23.6, 60.8, 37.1, 77.9], GB: [49.8, -8.7, 60.9, 1.8], AE: [22.6, 51.5, 26.1, 56.4], US: [24, -125, 49.5, -66.9] };

/** Fake Nominatim: reverse geocoding by the demo countries' bounding boxes. */
export function fakeGeocoder() {
  setGeocoderFetch(async (url) => {
    const u = new URL(url);
    const lat = Number(u.searchParams.get('lat'));
    const lng = Number(u.searchParams.get('lon'));
    const cc = Object.entries(BOXES).find(([, b]) => lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3])?.[0];
    return { ok: true, json: async () => ({ address: cc ? { country_code: cc.toLowerCase() } : {} }) };
  });
}

/** A signed-in, fully onboarded user in a country. */
export async function onboardedUser(cc, name = 'Tester') {
  const s = await signIn(freshPhone(cc), cc);
  const city = await pool.query('SELECT id FROM cities WHERE country_code = $1 ORDER BY population DESC NULLS LAST LIMIT 1', [cc]);
  await pool.query(
    `UPDATE users SET country_code = $2, city_id = $3, display_name = $4, onboarding_completed_at = now(),
       currency = (SELECT currency FROM countries WHERE code = $2), created_at = now() - interval '10 days' WHERE id = $1`,
    [s.user.id, cc, city.rows[0].id, name],
  );
  return s;
}

/** A small JPEG with EXIF data (to verify stripping). */
export async function testJpeg(color = { r: 200, g: 120, b: 40 }) {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } })
    .toBuffer();
}

export const PLACES = {
  PK: { lat: 33.6938, lng: 73.0652 }, // Islamabad
  GB: { lat: 51.5308, lng: -0.1238 }, // London
  AE: { lat: 25.1972, lng: 55.2744 }, // Dubai
  US: { lat: 40.758, lng: -73.9855 }, // New York
};

/** Post a found item as `s` (multipart). */
export async function postFound(s, cc, overrides = {}, photos = 1) {
  const data = {
    category: 'wallet',
    description: 'Black leather wallet',
    questions: [
      { question: 'What is inside?', answer: 'Two cards and a photo' },
      { question: 'Exact cash amount?', answer: '1500' },
    ],
    location: { ...PLACES[cc], label: 'Near the market' },
    foundAt: new Date(Date.now() - 3600_000).toISOString(),
    currentLocation: 'with_me',
    guidanceAccepted: true,
    ...overrides,
  };
  let req = s.agent.post('/api/found-items').set(auth(s.token)).field('data', JSON.stringify(data));
  for (let i = 0; i < photos; i++) req = req.attach('photos', await testJpeg(), `p${i}.jpg`);
  return req;
}
