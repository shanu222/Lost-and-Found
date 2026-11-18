// Pluggable SMS provider, chosen live in Admin → Settings (sms_provider):
//   dev    — logs the code to the API logs (development / demos)
//   twilio — Twilio REST API
import { logger } from '../../lib/logger.js';
import { settings } from '../settings.js';

const devProvider = {
  name: 'dev',
  outbox: [],
  async send({ to, body }) {
    this.outbox.push({ to, body, at: new Date() });
    if (this.outbox.length > 100) this.outbox.shift();
    logger.info(`[sms:dev] to=${to} body="${body}"`);
  },
};

const twilioProvider = {
  name: 'twilio',
  async send({ to, body }, s) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(s.twilio_account_sid)}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${s.twilio_account_sid}:${s.twilio_auth_token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: s.twilio_from, Body: body }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status}`);
  },
};

export { devProvider };

/** Send through whichever provider is configured right now. Returns the provider name. */
export async function sendSms(msg) {
  const s = await settings();
  const provider = s.sms_provider === 'twilio' && s.twilio_account_sid && s.twilio_auth_token ? twilioProvider : devProvider;
  await provider.send(msg, s);
  return provider.name;
}

const OTP_TEXT = {
  en: (code) => `Your FoundBack code is ${code}. It expires in 5 minutes. Never share it with anyone.`,
  ur: (code) => `آپ کا FoundBack کوڈ ${code} ہے۔ یہ 5 منٹ میں ختم ہو جائے گا۔ یہ کسی کے ساتھ شیئر نہ کریں۔`,
  ar: (code) => `رمز FoundBack الخاص بك هو ${code}. ينتهي خلال 5 دقائق. لا تشاركه مع أي شخص.`,
};
export const otpMessage = (code, language = 'en') => (OTP_TEXT[language] ?? OTP_TEXT.en)(code);
