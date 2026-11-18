// Transactional email through Resend. Key and sender come from live settings
// (Admin → Settings → Email), falling back to RESEND_API_KEY / EMAIL_FROM.
// Without a key, emails are only logged (development).
import { Resend } from 'resend';
import { logger } from '../lib/logger.js';
import { settings } from './settings.js';

let client = null;
let clientKey = null;

export async function sendEmail({ to, subject, html, text }) {
  const s = await settings();
  if (!s.resend_api_key) {
    logger.info({ to, subject }, '[email:dev] email not sent (no Resend key)');
    return { id: 'dev' };
  }
  if (clientKey !== s.resend_api_key) {
    client = new Resend(s.resend_api_key);
    clientKey = s.resend_api_key;
  }
  const { data, error } = await client.emails.send({ from: s.email_from, to, subject, html, text });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}
