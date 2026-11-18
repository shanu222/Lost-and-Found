// Transactional email through Resend. Without RESEND_API_KEY emails are only
// logged (development). Templates are rendered in the recipient's language by
// the caller (later stages: notifications).
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const client = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail({ to, subject, html, text }) {
  if (!client) {
    logger.info({ to, subject }, '[email:dev] email not sent (RESEND_API_KEY missing)');
    return { id: 'dev' };
  }
  const { data, error } = await client.emails.send({ from: env.EMAIL_FROM, to, subject, html, text });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}
