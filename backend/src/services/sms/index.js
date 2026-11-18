// Pluggable SMS provider. Select with SMS_PROVIDER:
//   dev    — logs the message to the console (local development / demos)
//   twilio — Twilio REST API (no SDK needed)
// To add a provider, implement `send({ to, body })` and register it below.
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const devProvider = {
  name: 'dev',
  /** Last messages per number; used by tests and by the optional OTP_DEV_ECHO. */
  outbox: [],
  async send({ to, body }) {
    this.outbox.push({ to, body, at: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    // Intentionally visible in the console in development.
    logger.info(`[sms:dev] to=${to} body="${body}"`);
  },
};

const twilioProvider = {
  name: 'twilio',
  async send({ to, body }) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
  },
};

const providers = { dev: devProvider, twilio: twilioProvider };
export const sms = providers[env.SMS_PROVIDER];
export { devProvider };

// OTP message in the user's language (falls back to English).
const OTP_TEXT = {
  en: (code) => `Your FoundBack code is ${code}. It expires in 5 minutes. Never share it with anyone.`,
  ur: (code) => `آپ کا FoundBack کوڈ ${code} ہے۔ یہ 5 منٹ میں ختم ہو جائے گا۔ یہ کسی کے ساتھ شیئر نہ کریں۔`,
  ar: (code) => `رمز FoundBack الخاص بك هو ${code}. ينتهي خلال 5 دقائق. لا تشاركه مع أي شخص.`,
};
export const otpMessage = (code, language = 'en') => (OTP_TEXT[language] ?? OTP_TEXT.en)(code);
