// Demo data for 4 launch countries: Pakistan, United Kingdom, UAE, USA.
// Idempotent — safe to run repeatedly (`npm run seed`).
//
// Creates: per-country config tweaks (bbox), popular cities, demo users
// (one finder + one owner per country, plus an admin) and a handful of found
// items with encrypted hidden questions. Demo users sign in with the phone
// numbers below; with SMS_PROVIDER=dev the OTP is printed in the API logs
// (and returned in the response when OTP_DEV_ECHO=true).
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';
import { pool, tx } from './pool.js';
import { blindIndex, encrypt } from '../lib/crypto.js';
import { approximate } from '../lib/geo.js';
import { normalizePhone } from '../lib/phone.js';
import { matchLostReport } from '../services/matching.js';

const BBOX = {
  PK: [23.6, 60.8, 37.1, 77.9],
  GB: [49.8, -8.7, 60.9, 1.8],
  AE: [22.6, 51.5, 26.1, 56.4],
  US: [18.9, -179.2, 71.4, -66.9],
};

// [name, region, lat, lng, population]
const CITIES = {
  PK: [
    ['Karachi', 'Sindh', 24.8607, 67.0011, 14910352], ['Lahore', 'Punjab', 31.5204, 74.3587, 11126285],
    ['Faisalabad', 'Punjab', 31.4504, 73.135, 3203846], ['Rawalpindi', 'Punjab', 33.5651, 73.0169, 2098231],
    ['Gujranwala', 'Punjab', 32.1877, 74.1945, 2027001], ['Peshawar', 'Khyber Pakhtunkhwa', 34.0151, 71.5249, 1970042],
    ['Multan', 'Punjab', 30.1575, 71.5249, 1871843], ['Hyderabad', 'Sindh', 25.396, 68.3578, 1732693],
    ['Islamabad', 'Islamabad Capital Territory', 33.6844, 73.0479, 1014825], ['Quetta', 'Balochistan', 30.1798, 66.975, 1001205],
    ['Sialkot', 'Punjab', 32.4945, 74.5229, 655852], ['Abbottabad', 'Khyber Pakhtunkhwa', 34.1688, 73.2215, 208491],
  ],
  GB: [
    ['London', 'England', 51.5074, -0.1278, 8799800], ['Birmingham', 'England', 52.4862, -1.8904, 1144900],
    ['Leeds', 'England', 53.8008, -1.5491, 812000], ['Glasgow', 'Scotland', 55.8642, -4.2518, 635640],
    ['Manchester', 'England', 53.4808, -2.2426, 552000], ['Edinburgh', 'Scotland', 55.9533, -3.1883, 526470],
    ['Liverpool', 'England', 53.4084, -2.9916, 486100], ['Bristol', 'England', 51.4545, -2.5879, 472400],
    ['Cardiff', 'Wales', 51.4816, -3.1791, 362400], ['Belfast', 'Northern Ireland', 54.5973, -5.9301, 345418],
  ],
  AE: [
    ['Dubai', 'Dubai', 25.2048, 55.2708, 3604000], ['Abu Dhabi', 'Abu Dhabi', 24.4539, 54.3773, 1512000],
    ['Sharjah', 'Sharjah', 25.3463, 55.4209, 1405000], ['Al Ain', 'Abu Dhabi', 24.2075, 55.7447, 766936],
    ['Ajman', 'Ajman', 25.4052, 55.5136, 504846], ['Ras Al Khaimah', 'Ras Al Khaimah', 25.8007, 55.9762, 345000],
    ['Fujairah', 'Fujairah', 25.1288, 56.3265, 152000], ['Umm Al Quwain', 'Umm Al Quwain', 25.5647, 55.5552, 80000],
  ],
  US: [
    ['New York', 'New York', 40.7128, -74.006, 8335897], ['Los Angeles', 'California', 34.0522, -118.2437, 3822238],
    ['Chicago', 'Illinois', 41.8781, -87.6298, 2665039], ['Houston', 'Texas', 29.7604, -95.3698, 2302878],
    ['Phoenix', 'Arizona', 33.4484, -112.074, 1644409], ['Philadelphia', 'Pennsylvania', 39.9526, -75.1652, 1567258],
    ['San Antonio', 'Texas', 29.4241, -98.4936, 1472909], ['San Diego', 'California', 32.7157, -117.1611, 1381611],
    ['Dallas', 'Texas', 32.7767, -96.797, 1299544], ['San Francisco', 'California', 37.7749, -122.4194, 808437],
    ['Seattle', 'Washington', 47.6062, -122.3321, 749256], ['Boston', 'Massachusetts', 42.3601, -71.0589, 650706],
  ],
};

// [phone, display name, country, city, language, role]
const USERS = [
  ['+923001234567', 'Ayesha', 'PK', 'Islamabad', 'ur', 'user'],
  ['+923331234567', 'Bilal', 'PK', 'Lahore', 'en', 'user'],
  ['+923011111111', 'FoundBack Admin', 'PK', 'Islamabad', 'en', 'admin'],
  ['+447412345678', 'Oliver', 'GB', 'London', 'en', 'user'],
  ['+447812345678', 'Amelia', 'GB', 'Manchester', 'en', 'user'],
  ['+971501234567', 'Fatima', 'AE', 'Dubai', 'ar', 'user'],
  ['+971551234567', 'Rahul', 'AE', 'Abu Dhabi', 'en', 'user'],
  ['+12125550147', 'Jessica', 'US', 'New York', 'en', 'user'],
  ['+13125550199', 'Marcus', 'US', 'Chicago', 'en', 'user'],
];

const TZ = { PK: 'Asia/Karachi', GB: 'Europe/London', AE: 'Asia/Dubai', US: 'America/New_York' };
const CURRENCY = { PK: 'PKR', GB: 'GBP', AE: 'AED', US: 'USD' };
const UNITS = { PK: 'km', GB: 'mi', AE: 'km', US: 'mi' };

// [country, finder phone, city, category, description, dLat, dLng, daysAgo, status, current location, area, [q, a][]]
const ITEMS = [
  ['PK', '+923001234567', 'Islamabad', 'phone', 'Black Samsung phone with a clear case', 0.01, 0.02, 2, 'waiting', 'with_me', 'F-7 Markaz', [['What is the phone wallpaper?', 'A photo of the Faisal Mosque at night'], ['What colour is the SIM tray side?', 'Silver']]],
  ['PK', '+923001234567', 'Rawalpindi', 'wallet', 'Brown leather wallet', -0.01, 0.01, 5, 'waiting', 'with_me', 'Saddar', [['What is inside the wallet?', 'Two bank cards, a metro card and a family photo'], ['Exact cash amount?', '3500']]],
  ['PK', '+923331234567', 'Lahore', 'national_id', 'CNIC card found near the bus stop', 0.02, -0.01, 1, 'waiting', 'police', 'Liberty Market', [['Name on the card?', 'Muhammad Usman'], ['Father\'s name on the card?', 'Abdul Rehman']]],
  ['PK', '+923331234567', 'Lahore', 'keys', 'Car keys with a blue keychain', -0.02, 0.0, 12, 'returned', 'with_me', 'Gulberg', [['Which car brand?', 'Suzuki'], ['What is on the keychain?', 'A small cricket bat']]],
  ['GB', '+447412345678', 'London', 'bag', 'Grey laptop backpack', 0.01, -0.02, 3, 'waiting', 'shop_office', 'King\'s Cross', [['What is inside the bag?', 'A Dell laptop, a charger and a blue notebook'], ['Any stickers on the laptop?', 'A NASA sticker']]],
  ['GB', '+447812345678', 'Manchester', 'keys', 'Bunch of house keys on a red lanyard', 0.0, 0.01, 6, 'waiting', 'with_me', 'Northern Quarter', [['How many keys?', '4'], ['What is written on the lanyard?', 'University of Manchester']]],
  ['GB', '+447412345678', 'London', 'watch', 'Silver wristwatch', -0.015, 0.01, 20, 'returned', 'with_me', 'Southbank', [['Brand of the watch?', 'Seiko'], ['Any engraving?', 'To Tom, love Mum']]],
  ['AE', '+971501234567', 'Dubai', 'phone', 'iPhone in a pink case', 0.01, 0.01, 1, 'waiting', 'police', 'Dubai Mall area', [['Phone wallpaper?', 'A cat sleeping on a sofa'], ['Model?', 'iPhone 15']]],
  ['AE', '+971551234567', 'Abu Dhabi', 'wallet', 'Black wallet found at the corniche', -0.01, 0.02, 4, 'waiting', 'with_me', 'Corniche', [['What is inside?', 'Emirates ID, a gym card and 200 dirhams'], ['Colour of the stitching?', 'Red']]],
  ['AE', '+971501234567', 'Sharjah', 'jewellery', 'Gold bracelet', 0.02, -0.01, 15, 'returned', 'with_me', 'Al Majaz', [['Describe the clasp', 'Heart-shaped'], ['Any engraving?', 'S & M']]],
  ['US', '+12125550147', 'New York', 'laptop', 'MacBook in a black sleeve', 0.01, -0.01, 2, 'waiting', 'shop_office', 'Midtown', [['Serial number or sticker?', 'Sticker of the Brooklyn Bridge'], ['What is the login name?', 'jlee']]],
  ['US', '+13125550199', 'Chicago', 'pets', 'Small brown dog with a green collar', -0.01, 0.01, 1, 'waiting', 'with_me', 'Lincoln Park', [['Dog\'s name?', 'Biscuit'], ['What breed?', 'Dachshund mix']]],
  ['US', '+12125550147', 'New York', 'bank_cards', 'Bank card found at a coffee shop', 0.0, 0.02, 7, 'returned', 'shop_office', 'Chelsea', [['Name on the card?', 'Daniel Brooks'], ['Which bank?', 'Chase']]],
];

export async function seed() {
  // Demo data must never reach a real deployment by accident.
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed demo data in production. Run `npm run seed -- --force` if you really want demo data.');
  }
  await migrate({ log: { info: () => {} } });
  await tx(async (db) => {
    for (const [cc, bbox] of Object.entries(BBOX)) {
      await db.query('UPDATE countries SET bbox = $2 WHERE code = $1 AND bbox IS NULL', [cc, bbox]);
    }

    const cityIds = {};
    for (const [cc, list] of Object.entries(CITIES)) {
      for (const [name, region, lat, lng, population] of list) {
        const { rows } = await db.query(
          `INSERT INTO cities (country_code, name, region, lat, lng, population, source, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,'seed',$7)
           ON CONFLICT (country_code, external_id) DO UPDATE SET population = EXCLUDED.population
           RETURNING id`,
          [cc, name, region, lat, lng, population, `seed:${cc}:${name.toLowerCase().replace(/\s+/g, '-')}`],
        );
        cityIds[`${cc}:${name}`] = { id: rows[0].id, lat, lng };
      }
    }

    const userIds = {};
    for (const [phoneRaw, name, cc, city, language, role] of USERS) {
      const phone = normalizePhone(phoneRaw, cc);
      const { rows } = await db.query(
        `INSERT INTO users (display_name, phone_enc, phone_hash, phone_last4, phone_verified_at, country_code, city_id,
                            language, text_dir, timezone, currency, units, locale, role, onboarding_completed_at, trust_score)
         VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),10)
         ON CONFLICT (phone_hash) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role
         RETURNING id`,
        [name, encrypt(phone.e164), blindIndex(phone.e164, 'phone'), phone.last4, cc, cityIds[`${cc}:${city}`].id,
          language, ['ur', 'ar'].includes(language) ? 'rtl' : 'ltr', TZ[cc], CURRENCY[cc], UNITS[cc], `${language}-${cc}`, role],
      );
      userIds[phoneRaw] = rows[0].id;
    }

    // Found items: only seed once (keyed by description + finder).
    for (const [cc, finder, city, category, description, dLat, dLng, daysAgo, status, where, area, questions] of ITEMS) {
      const finderId = userIds[finder];
      const exists = await db.query('SELECT 1 FROM found_items WHERE finder_id = $1 AND description = $2', [finderId, description]);
      if (exists.rowCount) continue;
      const c = cityIds[`${cc}:${city}`];
      const lat = c.lat + dLat;
      const lng = c.lng + dLng;
      const approx = approximate(lat, lng, 500);
      const foundAt = new Date(Date.now() - daysAgo * 864e5);
      const { rows } = await db.query(
        `INSERT INTO found_items (country_code, finder_id, city_id, category, description, lat, lng, approx_lat, approx_lng,
                                  area_label, found_at, current_location, status, returned_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$11) RETURNING id`,
        [cc, finderId, c.id, category, description, lat, lng, approx.lat, approx.lng, area, foundAt, where, status,
          status === 'returned' ? new Date(foundAt.getTime() + 2 * 864e5) : null],
      );
      for (const [i, [q, a]] of questions.entries()) {
        await db.query(
          'INSERT INTO hidden_questions (found_item_id, country_code, question, answer_enc, position) VALUES ($1,$2,$3,$4,$5)',
          [rows[0].id, cc, q, encrypt(a), i],
        );
      }
      if (status === 'returned') {
        await db.query('UPDATE users SET returns_count = returns_count + 1, points = points + 50 WHERE id = $1', [finderId]);
      }
    }

    // Completed returns with consented success stories, plus one open claim to review.
    for (const [cc, description, claimantPhone, story] of RETURNS) {
      const item = (await db.query('SELECT * FROM found_items WHERE country_code = $1 AND description = $2', [cc, description])).rows[0];
      const claimantId = userIds[claimantPhone];
      if (!item || (await db.query('SELECT 1 FROM claims WHERE found_item_id = $1', [item.id])).rowCount) continue;
      const decided = new Date(new Date(item.found_at).getTime() + 864e5);
      const claim = (await db.query(
        `INSERT INTO claims (country_code, found_item_id, claimant_id, status, decided_at, created_at, expires_at)
         VALUES ($1,$2,$3,'approved',$4,$4,$4) RETURNING id`,
        [cc, item.id, claimantId, decided],
      )).rows[0];
      const qs = await db.query('SELECT id, answer_enc FROM hidden_questions WHERE found_item_id = $1', [item.id]);
      for (const q of qs.rows) await db.query('INSERT INTO claim_answers (claim_id, question_id, answer_enc) VALUES ($1,$2,$3)', [claim.id, q.id, q.answer_enc]);
      await db.query('INSERT INTO conversations (country_code, claim_id, finder_id, claimant_id) VALUES ($1,$2,$3,$4)', [cc, claim.id, item.finder_id, claimantId]);
      const h = (await db.query(
        `INSERT INTO handovers (country_code, claim_id, found_item_id, owner_id, finder_id, finder_agreed_at, owner_agreed_at, method, place_name, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6,'meet','Police station',$7) RETURNING id`,
        [cc, claim.id, item.id, claimantId, item.finder_id, decided, item.returned_at],
      )).rows[0];
      await db.query(
        `INSERT INTO ratings (country_code, handover_id, rater_id, ratee_id, stars, note, share_story) VALUES ($1,$2,$3,$4,5,$5,true)`,
        [cc, h.id, claimantId, item.finder_id, story],
      );
    }

    const wallet = (await db.query("SELECT * FROM found_items WHERE country_code = 'PK' AND description = 'Brown leather wallet'")).rows[0];
    const bilal = userIds['+923331234567'];
    if (wallet && !(await db.query('SELECT 1 FROM claims WHERE found_item_id = $1', [wallet.id])).rowCount) {
      const claim = (await db.query(
        "INSERT INTO claims (country_code, found_item_id, claimant_id) VALUES ('PK',$1,$2) RETURNING id",
        [wallet.id, bilal],
      )).rows[0];
      const qs = await db.query('SELECT id, position FROM hidden_questions WHERE found_item_id = $1 ORDER BY position', [wallet.id]);
      const answers = ['Two bank cards, a metro card and a photo of my parents', 'About 3500 rupees'];
      for (const q of qs.rows) await db.query('INSERT INTO claim_answers (claim_id, question_id, answer_enc) VALUES ($1,$2,$3)', [claim.id, q.id, encrypt(answers[q.position] ?? '—')]);
      await db.query("INSERT INTO claim_proofs (claim_id, country_code, kind, text_enc) VALUES ($1,'PK','contents',$2)", [claim.id, encrypt('Brown leather, bought from Saddar. Inside: HBL and Meezan cards, Metro bus card, a small family photo.')]);
      await db.query("INSERT INTO conversations (country_code, claim_id, finder_id, claimant_id) VALUES ('PK',$1,$2,$3)", [claim.id, wallet.finder_id, bilal]);
      await db.query("UPDATE found_items SET status = 'under_review' WHERE id = $1", [wallet.id]);
    }
  });

  // A lost report that matches a found laptop (runs the real matcher).
  const marcus = (await pool.query("SELECT id FROM users WHERE display_name = 'Marcus'")).rows[0];
  if (marcus && !(await pool.query('SELECT 1 FROM lost_reports WHERE owner_id = $1', [marcus.id])).rowCount) {
    const { rows } = await pool.query(
      `INSERT INTO lost_reports (country_code, owner_id, category, description, lat, lng, radius_m, lost_from, lost_to, search_text)
       VALUES ('US',$1,'laptop','Silver MacBook in a black sleeve with a Brooklyn Bridge sticker',40.72,-74.01,3000, now() - interval '4 days', now() - interval '2 days', 'silver macbook in a black sleeve')
       RETURNING *`,
      [marcus.id],
    );
    await matchLostReport(rows[0]).catch(() => 0);
  }
}

const RETURNS = [
  ['PK', 'Car keys with a blue keychain', '+923001234567', 'I had given up on my car keys. Bilal kept them safe and we met at the Gulberg police station. Shukriya!'],
  ['GB', 'Silver wristwatch', '+447812345678', "My late grandfather's watch is back on my wrist. Thank you, Oliver — and thank you FoundBack."],
  ['AE', 'Gold bracelet', '+971551234567', 'Returned within two days at the Al Majaz police station. Wonderful people.'],
  ['US', 'Bank card found at a coffee shop', '+13125550199', 'Got my card back before I even finished cancelling it. Amazing!'],
];


if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => {
      console.log('Seed complete. Demo phone numbers:');
      for (const [phone, name, cc, , , role] of USERS) console.log(`  ${cc}  ${phone}  ${name}${role === 'admin' ? ' (admin)' : ''}`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
