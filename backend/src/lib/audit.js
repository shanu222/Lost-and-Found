// Audit log of sensitive actions (sign-in, phone change, country change,
// claim decisions, admin actions…). `meta` must never contain secrets or
// personal data such as phone numbers or ID numbers.
import { query } from '../db/pool.js';
import { logger } from './logger.js';

export async function audit({ actorId = null, countryCode = null, action, targetType = null, targetId = null, meta = {}, ip = null }, db = { query }) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, country_code, action, target_type, target_id, meta, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [actorId, countryCode, action, targetType, targetId ? String(targetId) : null, meta, ip],
    );
  } catch (err) {
    // Auditing must never break the user's request; log loudly instead.
    logger.error({ err, action }, 'audit log write failed');
  }
}
