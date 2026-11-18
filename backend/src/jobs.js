// Periodic background jobs (every 10 minutes). Safe to run on several
// instances: each statement is idempotent; set JOBS_ENABLED=false on extras.
import { query } from './db/pool.js';
import { logger } from './lib/logger.js';
import { getCountry } from './services/countries.js';
import { notify } from './services/notifications.js';

export async function runJobs() {
  // 1. Claims expire after 7 days without a response.
  const expired = await query(
    `UPDATE claims c SET status = 'expired', updated_at = now()
     FROM found_items f WHERE f.id = c.found_item_id AND c.status IN ('pending','follow_up') AND c.expires_at < now()
     RETURNING c.claimant_id, c.country_code, c.found_item_id, f.category`,
  );
  for (const c of expired.rows) {
    await notify({ userId: c.claimant_id, countryCode: c.country_code.trim(), type: 'claim_expired', data: { category: c.category }, url: '/my/claims' });
  }
  await query(
    `UPDATE found_items f SET status = 'waiting' WHERE status = 'under_review'
       AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.found_item_id = f.id AND c.status IN ('pending','follow_up','approved'))`,
  );

  // 2. Found posts: reminder after 90 days with the country's guidance.
  const old = await query(
    `UPDATE found_items SET reminder_sent_at = now()
     WHERE status IN ('waiting','under_review') AND reminder_sent_at IS NULL AND created_at < now() - interval '90 days'
     RETURNING id, finder_id, country_code, category`,
  );
  for (const f of old.rows) {
    const country = await getCountry(f.country_code);
    await notify({ userId: f.finder_id, countryCode: f.country_code.trim(), type: 'found_reminder', data: { category: f.category, itemId: f.id, authority: country?.authority_name ?? '' }, url: '/my/found' });
  }

  // 3. Handover reminders ~2 hours before the agreed time.
  const soon = await query(
    `UPDATE handovers h SET reminder_sent_at = now() FROM found_items f
     WHERE f.id = h.found_item_id AND h.completed_at IS NULL AND h.reminder_sent_at IS NULL
       AND h.scheduled_for BETWEEN now() AND now() + interval '2 hours'
     RETURNING h.claim_id, h.finder_id, h.owner_id, h.country_code, f.category`,
  );
  for (const h of soon.rows) {
    for (const uid of [h.finder_id, h.owner_id]) {
      await notify({ userId: uid, countryCode: h.country_code.trim(), type: 'handover_reminder', data: { category: h.category, claimId: h.claim_id }, url: `/claims/${h.claim_id}/handover` });
    }
  }

  // 4. Travel mode ends after 30 days.
  await query("UPDATE lost_reports SET status = 'expired' WHERE is_travel AND status = 'open' AND travel_until < now()");
  await query('UPDATE users SET travel_country_code = NULL, travel_until = NULL WHERE travel_until < now()');

  // 5. Housekeeping.
  await query("DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'");
  await query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
  await query('DELETE FROM geocode_cache WHERE expires_at < now()');
  await query("DELETE FROM saved_alerts WHERE active_until < now() - interval '30 days'");
}

export function startJobs() {
  const tick = () => runJobs().catch((err) => logger.error({ err }, 'background jobs failed'));
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
