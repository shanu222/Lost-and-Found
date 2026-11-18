// Stages 5–6: matching, alerts, notifications and admin/moderator permissions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { PLACES, auth, fakeGeocoder, onboardedUser, postFound, signIn } from './helpers.js';

beforeAll(fakeGeocoder);
afterAll(() => pool.end());

describe('matching and alerts', () => {
  it('matches a new found item with an open lost report and notifies both', async () => {
    const owner = await onboardedUser('AE');
    const lost = await owner.agent.post('/api/lost-reports').set(auth(owner.token)).field('data', JSON.stringify({
      category: 'bag', description: 'Grey laptop backpack with a NASA patch', location: PLACES.AE, radiusM: 2000,
      lostFrom: new Date(Date.now() - 2 * 864e5).toISOString(), lostTo: new Date(Date.now() - 864e5).toISOString(),
      identifier: 'SN-ABC-123',
    }));
    expect(lost.status).toBe(201);
    const finder = await onboardedUser('AE');
    await postFound(finder, 'AE', { category: 'bag', description: 'Grey backpack with NASA patch' });
    const mine = await owner.agent.get('/api/lost-reports/mine').set(auth(owner.token)).expect(200);
    expect(mine.body.reports[0].matches.length).toBe(1);
    expect(mine.body.reports[0].matches[0].score).toBeGreaterThanOrEqual(55);
    const n = await owner.agent.get('/api/notifications').set(auth(owner.token)).expect(200);
    expect(n.body.notifications.some((x) => x.type === 'match_for_owner')).toBe(true);
    const nf = await finder.agent.get('/api/notifications').set(auth(finder.token)).expect(200);
    expect(nf.body.notifications.some((x) => x.type === 'match_for_finder')).toBe(true);
  });

  it('never matches across countries', async () => {
    const owner = await onboardedUser('GB');
    await owner.agent.post('/api/lost-reports').set(auth(owner.token)).field('data', JSON.stringify({
      category: 'keys', description: 'Red lanyard keys', location: PLACES.GB,
      lostFrom: new Date(Date.now() - 864e5).toISOString(), lostTo: new Date().toISOString(),
    })).expect(201);
    const finder = await onboardedUser('US');
    await postFound(finder, 'US', { category: 'keys', description: 'Red lanyard keys' });
    const mine = await owner.agent.get('/api/lost-reports/mine').set(auth(owner.token));
    expect(mine.body.reports[0].matches).toEqual([]);
  });

  it('saved alerts notify when a matching item is found nearby', async () => {
    const watcher = await onboardedUser('US');
    await watcher.agent.post('/api/alerts').set(auth(watcher.token)).send({ category: 'wallet', keywords: 'black', location: PLACES.US, radiusM: 3000, days: 30 }).expect(201);
    const finder = await onboardedUser('US');
    await postFound(finder, 'US', { description: 'Black leather wallet' });
    const n = await watcher.agent.get('/api/notifications').set(auth(watcher.token)).expect(200);
    expect(n.body.notifications.some((x) => x.type === 'alert_match')).toBe(true);
  });
});

describe('admin and moderator permissions', () => {
  it('normal users cannot use the admin API', async () => {
    const u = await onboardedUser('PK');
    await u.agent.get('/api/admin/dashboard').set(auth(u.token)).expect(403);
  });

  it('moderators only see their countries; admins see all', async () => {
    const admin = await signIn('foundback@demo.foundback.test', 'PK'); // seeded admin
    const mod = await onboardedUser('GB', 'Mod');
    await admin.agent.put(`/api/admin/moderators/${mod.user.id}`).set(auth(admin.token)).send({ countries: ['GB'] }).expect(200);

    const pkUser = await onboardedUser('PK');
    const { body } = await postFound(pkUser, 'PK');
    const reporter = await onboardedUser('PK');
    await reporter.agent.post('/api/reports').set(auth(reporter.token)).send({ targetType: 'found_item', targetId: body.item.id, reason: 'scam' }).expect(201);

    const modReports = await mod.agent.get('/api/admin/reports').set(auth(mod.token)).expect(200);
    expect(modReports.body.reports.every((r) => r.countryCode === 'GB')).toBe(true);
    await mod.agent.get('/api/admin/reports?country=PK').set(auth(mod.token)).expect(403);
    await mod.agent.get('/api/admin/dashboard?country=PK').set(auth(mod.token)).expect(403);
    const dash = await mod.agent.get('/api/admin/dashboard').set(auth(mod.token)).expect(200);
    expect(dash.body.perCountry.every((c) => c.countryCode === 'GB')).toBe(true);
    // Moderators cannot edit country configuration or ban outside their countries.
    await mod.agent.patch('/api/admin/countries/GB').set(auth(mod.token)).send({ emergencyNumber: '112' }).expect(403);
    await mod.agent.post(`/api/admin/users/${pkUser.user.id}/ban`).set(auth(mod.token)).send({ reason: 'test ban' }).expect(404);

    const adminReports = await admin.agent.get('/api/admin/reports?country=PK').set(auth(admin.token)).expect(200);
    const report = adminReports.body.reports.find((r) => r.targetId === body.item.id);
    expect(report).toBeTruthy();
    await admin.agent.post(`/api/admin/reports/${report.id}`).set(auth(admin.token)).send({ action: 'remove_content' }).expect(200);
    await reporter.agent.get(`/api/found-items/${body.item.id}`).set(auth(reporter.token)).expect(404);
  });

  it('admins edit per-country configuration; bans take effect immediately', async () => {
    const admin = await signIn('foundback@demo.foundback.test', 'PK');
    const res = await admin.agent.patch('/api/admin/countries/LK').set(auth(admin.token))
      .send({ nationalIdName: 'NIC', emergencyNumber: '119', languages: ['ta'], guidance: { en: { ids: 'Hand NICs to the police.' } } }).expect(200);
    expect(res.body.country).toMatchObject({ nationalIdName: 'NIC', emergencyNumber: '119', languages: ['ta'] });
    await admin.agent.patch('/api/admin/countries/LK').set(auth(admin.token)).send({ idMaskPattern: '([' }).expect(400);

    const victim = await onboardedUser('PK');
    await admin.agent.post(`/api/admin/users/${victim.user.id}/ban`).set(auth(admin.token)).send({ reason: 'fake claims' }).expect(200);
    const after = await victim.agent.get('/api/me').set(auth(victim.token));
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('identity checks go to the review queue and never expose the ID number', async () => {
    const u = await onboardedUser('AE');
    const selfie = await (await import('./helpers.js')).testJpeg();
    await u.agent.post('/api/me/identity').set(auth(u.token)).field('data', JSON.stringify({ idNumber: '784-1990-1234567-1' })).attach('selfie', selfie, 's.jpg').expect(201);
    const admin = await signIn('foundback@demo.foundback.test', 'PK');
    const q = await admin.agent.get('/api/admin/identity?country=AE').set(auth(admin.token)).expect(200);
    expect(JSON.stringify(q.body)).not.toContain('1234567');
    const check = q.body.checks.find((c) => c.user.id === u.user.id);
    await admin.agent.post(`/api/admin/identity/${check.id}`).set(auth(admin.token)).send({ decision: 'approved' }).expect(200);
    const me = await u.agent.get('/api/me').set(auth(u.token));
    expect(me.body.user.trust.identityVerified).toBe(true);
  });

  it('background jobs expire stale claims', async () => {
    const finder = await onboardedUser('PK');
    const owner = await onboardedUser('PK');
    const { body } = await postFound(finder, 'PK');
    const q = await owner.agent.get(`/api/found-items/${body.item.id}/questions`).set(auth(owner.token));
    const c = await owner.agent.post(`/api/found-items/${body.item.id}/claims`).set(auth(owner.token))
      .field('data', JSON.stringify({ answers: q.body.questions.map((x) => ({ questionId: x.id, answer: 'a' })), proof: { contents: 'cards' } }));
    await pool.query("UPDATE claims SET expires_at = now() - interval '1 minute' WHERE id = $1", [c.body.claim.id]);
    const { runJobs } = await import('../src/jobs.js');
    await runJobs();
    const after = await owner.agent.get(`/api/claims/${c.body.claim.id}`).set(auth(owner.token));
    expect(after.body.claim.status).toBe('expired');
    const item = await owner.agent.get(`/api/found-items/${body.item.id}`).set(auth(owner.token));
    expect(item.body.item.status).toBe('waiting');
  });
});
