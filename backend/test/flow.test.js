// Stages 2–4: posting, country scoping, claim → approval → handover code, chat.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { pool } from '../src/db/pool.js';
import { PLACES, auth, fakeGeocoder, onboardedUser, postFound } from './helpers.js';

beforeAll(fakeGeocoder);
afterAll(() => pool.end());

async function claimItem(s, itemId, answers = ['Two cards and a photo', '1500'], proof = { contents: 'Two cards, a photo of my kids' }) {
  const q = await s.agent.get(`/api/found-items/${itemId}/questions`).set(auth(s.token));
  if (q.status !== 200) return q;
  const data = { answers: q.body.questions.map((qq, i) => ({ questionId: qq.id, answer: answers[i] ?? 'x' })), proof };
  return s.agent.post(`/api/found-items/${itemId}/claims`).set(auth(s.token)).field('data', JSON.stringify(data));
}

describe('posting a found item', () => {
  it('creates the item, strips EXIF and shows only an approximate area', async () => {
    const finder = await onboardedUser('PK', 'Finder');
    const res = await postFound(finder, 'PK');
    expect(res.status).toBe(201);
    const item = res.body.item;
    expect(item.isMine).toBe(true);
    expect(item.exact).toEqual(PLACES.PK);

    const { rows } = await pool.query("SELECT data FROM local_files WHERE key LIKE 'pk/%' ORDER BY created_at DESC LIMIT 1");
    const meta = await sharp(rows[0].data).metadata();
    expect(meta.exif).toBeUndefined();

    const viewer = await onboardedUser('PK', 'Viewer');
    const seen = await viewer.agent.get(`/api/found-items/${item.id}`).set(auth(viewer.token)).expect(200);
    expect(seen.body.item.exact).toBeUndefined();
    expect(seen.body.item.area.radiusM).toBe(500);
    expect(JSON.stringify(seen.body)).not.toContain('Two cards and a photo'); // hidden answer never public
  });

  it('blocks phone numbers, emails and ID numbers in public text', async () => {
    const finder = await onboardedUser('PK');
    for (const description of ['Wallet, call 0300 1234567', 'Wallet — mail me at a@b.com', 'CNIC 35202-1234567-1 found']) {
      const res = await postFound(finder, 'PK', { description });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONTACT_DETAILS_BLOCKED');
    }
  });

  it('rejects a pin outside the user country', async () => {
    const finder = await onboardedUser('PK');
    const res = await postFound(finder, 'PK', { location: PLACES.AE });
    expect(res.body.error.code).toBe('LOCATION_OUTSIDE_COUNTRY');
  });

  it('never shows ID/document photos publicly', async () => {
    const finder = await onboardedUser('PK');
    const res = await postFound(finder, 'PK', { category: 'national_id', description: 'CNIC card near the bus stop', privateIdentifier: '35202-1234567-1' });
    expect(res.status).toBe(201);
    expect(res.body.item.photos.length).toBe(1); // finder sees it
    const other = await onboardedUser('PK');
    const seen = await other.agent.get(`/api/found-items/${res.body.item.id}`).set(auth(other.token)).expect(200);
    expect(seen.body.item.illustration).toBe(true);
    expect(seen.body.item.photos).toEqual([]);
  });

  it('requires the private ID number for ID cards', async () => {
    const finder = await onboardedUser('PK');
    const res = await postFound(finder, 'PK', { category: 'national_id', description: 'ID card' });
    expect(res.body.error.code).toBe('IDENTIFIER_REQUIRED');
  });
});

describe('country scoping', () => {
  it('a user can never read or claim another country item', async () => {
    const finder = await onboardedUser('PK');
    const { body } = await postFound(finder, 'PK');
    const uae = await onboardedUser('AE');
    await uae.agent.get(`/api/found-items/${body.item.id}`).set(auth(uae.token)).expect(404);
    await uae.agent.get(`/api/found-items/${body.item.id}/questions`).set(auth(uae.token)).expect(404);
    const claim = await uae.agent.post(`/api/found-items/${body.item.id}/claims`).set(auth(uae.token)).field('data', '{"answers":[]}');
    expect(claim.status).toBe(404);
    const list = await uae.agent.get('/api/found-items?status=all&limit=100').set(auth(uae.token)).expect(200);
    expect(list.body.items.every((i) => i.countryCode === 'AE')).toBe(true);
  });

  it('travel mode lets a traveller see and claim items in ONE other country', async () => {
    const finder = await onboardedUser('AE');
    const { body } = await postFound(finder, 'AE');
    const traveller = await onboardedUser('PK');
    await traveller.agent.get(`/api/found-items/${body.item.id}`).set(auth(traveller.token)).expect(404);
    await traveller.agent.post('/api/me/travel').set(auth(traveller.token)).send({ countryCode: 'AE' }).expect(200);
    await traveller.agent.get(`/api/found-items/${body.item.id}`).set(auth(traveller.token)).expect(200);
    const second = await traveller.agent.post('/api/me/travel').set(auth(traveller.token)).send({ countryCode: 'GB' });
    expect(second.body.error.code).toBe('TRAVEL_ACTIVE');
    const res = await claimItem(traveller, body.item.id);
    expect(res.status).toBe(201);
  });
});

describe('claim → approval → handover code', () => {
  it('runs the full flow', async () => {
    const finder = await onboardedUser('GB', 'Finder');
    const owner = await onboardedUser('GB', 'Owner');
    const other = await onboardedUser('GB', 'Other');
    const { body } = await postFound(finder, 'GB');
    const itemId = body.item.id;

    // Finder cannot claim their own item.
    expect((await claimItem(finder, itemId)).status).toBe(403);

    const c1 = await claimItem(owner, itemId);
    expect(c1.status).toBe(201);
    const c2 = await claimItem(other, itemId, ['A phone', '20']);
    expect(c2.status).toBe(201);
    // One active claim per user per item.
    expect((await claimItem(owner, itemId)).status).toBe(409);

    // Item is now "under review" publicly.
    const pub = await other.agent.get(`/api/found-items/${itemId}`).set(auth(other.token));
    expect(pub.body.item.status).toBe('under_review');

    // Finder reviews side by side.
    const review = await finder.agent.get(`/api/found-items/${itemId}/claims`).set(auth(finder.token)).expect(200);
    expect(review.body.claims).toHaveLength(2);
    const ownersClaim = review.body.claims.find((c) => c.id === c1.body.claim.id);
    expect(ownersClaim.comparison[0]).toMatchObject({ expected: 'Two cards and a photo', answer: 'Two cards and a photo' });
    // Other users cannot see the review.
    await other.agent.get(`/api/found-items/${itemId}/claims`).set(auth(other.token)).expect(403);

    // Ask a follow-up, the owner answers.
    await finder.agent.post(`/api/claims/${c1.body.claim.id}/decision`).set(auth(finder.token)).send({ action: 'ask', question: 'What colour is the photo frame?' }).expect(200);
    await owner.agent.post(`/api/claims/${c1.body.claim.id}/follow-up`).set(auth(owner.token)).send({ answer: 'No frame, it is a small print' }).expect(200);

    // Only the finder decides.
    await owner.agent.post(`/api/claims/${c1.body.claim.id}/decision`).set(auth(owner.token)).send({ action: 'approve' }).expect(403);
    await finder.agent.post(`/api/claims/${c1.body.claim.id}/decision`).set(auth(finder.token)).send({ action: 'approve' }).expect(200);

    // The other claim is rejected automatically and cannot claim again.
    const otherClaim = await other.agent.get(`/api/claims/${c2.body.claim.id}`).set(auth(other.token)).expect(200);
    expect(otherClaim.body.claim.status).toBe('rejected');
    expect((await claimItem(other, itemId)).status).toBe(403);

    // Handover: both must agree; only the owner sees the code.
    const hUrl = `/api/claims/${c1.body.claim.id}/handover`;
    const before = await owner.agent.get(hUrl).set(auth(owner.token)).expect(200);
    expect(before.body.handover.code).toBeNull();
    await owner.agent.post(`${hUrl}/agree`).set(auth(owner.token)).expect(200);
    await finder.agent.post(`${hUrl}/agree`).set(auth(finder.token)).expect(200);
    const ownerView = await owner.agent.get(hUrl).set(auth(owner.token)).expect(200);
    const finderView = await finder.agent.get(hUrl).set(auth(finder.token)).expect(200);
    expect(ownerView.body.handover.code).toMatch(/^\d{6}$/);
    expect(finderView.body.handover.code).toBeNull();

    // Phones only when both opt in.
    await owner.agent.put(hUrl).set(auth(owner.token)).send({ sharePhone: true, method: 'meet', place: { name: 'Kings Cross police', ...PLACES.GB } }).expect(200);
    expect((await finder.agent.get(hUrl).set(auth(finder.token))).body.handover.phones).toBeNull();
    await finder.agent.put(hUrl).set(auth(finder.token)).send({ sharePhone: true }).expect(200);
    expect((await finder.agent.get(hUrl).set(auth(finder.token))).body.handover.phones.other).toMatch(/^\+44/);

    // Owner cannot complete; wrong code fails; right code returns the item.
    await owner.agent.post(`${hUrl}/complete`).set(auth(owner.token)).send({ code: ownerView.body.handover.code }).expect(403);
    const wrong = ownerView.body.handover.code === '000000' ? '111111' : '000000';
    const bad = await finder.agent.post(`${hUrl}/complete`).set(auth(finder.token)).send({ code: wrong });
    expect(bad.body.error.code).toBe('HANDOVER_CODE_INVALID');
    const done = await finder.agent.post(`${hUrl}/complete`).set(auth(finder.token)).send({ code: ownerView.body.handover.code }).expect(200);
    expect(done.body.handover.completedAt).toBeTruthy();

    const item = await owner.agent.get(`/api/found-items/${itemId}`).set(auth(owner.token));
    expect(item.body.item.status).toBe('returned');
    const me = await finder.agent.get('/api/me').set(auth(finder.token));
    expect(me.body.user.returnsCount).toBe(1);

    // Rating + story.
    await owner.agent.post(`/api/claims/${c1.body.claim.id}/rating`).set(auth(owner.token)).send({ stars: 5, note: 'Thank you so much!', shareStory: true }).expect(201);
    await owner.agent.post(`/api/claims/${c1.body.claim.id}/rating`).set(auth(owner.token)).send({ stars: 5 }).expect(409);
    const stories = await other.agent.get('/api/stories').set(auth(other.token)).expect(200);
    expect(stories.body.stories.some((s) => s.note === 'Thank you so much!')).toBe(true);
  });

  it('compares ID numbers without revealing them and flags mismatches', async () => {
    const finder = await onboardedUser('PK');
    const { body } = await postFound(finder, 'PK', { category: 'national_id', description: 'ID card at the bus stop', privateIdentifier: '35202-1234567-1' });
    const liar = await onboardedUser('PK');
    const selfie = await (await import('./helpers.js')).testJpeg();
    const q = await liar.agent.get(`/api/found-items/${body.item.id}/questions`).set(auth(liar.token));
    const data = { answers: q.body.questions.map((qq) => ({ questionId: qq.id, answer: 'guess' })), proof: { identifier: '35202-9999999-1' } };
    const res = await liar.agent.post(`/api/found-items/${body.item.id}/claims`).set(auth(liar.token)).field('data', JSON.stringify(data)).attach('selfie', selfie, 's.jpg');
    expect(res.status).toBe(201);
    const review = await finder.agent.get(`/api/found-items/${body.item.id}/claims`).set(auth(finder.token)).expect(200);
    expect(review.body.claims[0].identifierMatch).toBe(false);
    expect(JSON.stringify(review.body)).not.toContain('9999999');
    expect(review.body.claims[0].flagged).toBe(true);
  });

  it('requires category proof and limits claims to 3 per day', async () => {
    const finder = await onboardedUser('US');
    const claimer = await onboardedUser('US');
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await postFound(finder, 'US', { description: `Wallet number ${'abcd'[i]}` })).body.item.id);
    const noProof = await claimItem(claimer, ids[0], undefined, {});
    expect(noProof.body.error.code).toBe('PROOF_REQUIRED');
    for (let i = 0; i < 3; i++) expect((await claimItem(claimer, ids[i])).status).toBe(201);
    expect((await claimItem(claimer, ids[3])).status).toBe(429);
  });
});

describe('masked chat', () => {
  it('masks phone numbers, emails and links, and only the two parties can read it', async () => {
    const finder = await onboardedUser('PK');
    const owner = await onboardedUser('PK');
    const { body } = await postFound(finder, 'PK');
    await claimItem(owner, body.item.id);
    const list = await owner.agent.get('/api/conversations').set(auth(owner.token)).expect(200);
    const cid = list.body.conversations[0].id;
    const sent = await owner.agent.post(`/api/conversations/${cid}/messages`).set(auth(owner.token))
      .send({ body: 'Call me on 0300 7654321 or mail x@y.com, see www.example.com' }).expect(201);
    expect(sent.body.message.body).not.toMatch(/7654321|x@y\.com|example\.com/);
    expect(sent.body.message.masked).toBe(true);
    const read = await finder.agent.get(`/api/conversations/${cid}/messages`).set(auth(finder.token)).expect(200);
    expect(read.body.messages).toHaveLength(1);
    const stranger = await onboardedUser('PK');
    await stranger.agent.get(`/api/conversations/${cid}/messages`).set(auth(stranger.token)).expect(404);
  });
});
