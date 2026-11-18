// Phone number validation/formatting with libphonenumber. Numbers are always
// validated against the user's country so a Pakistani profile cannot register
// with, say, a +1 number by mistake.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { badRequest } from './errors.js';

/**
 * @param {string} input raw input ("0300 1234567" or "+92 300 1234567")
 * @param {string} [countryCode] ISO country the number must belong to
 * @returns {{ e164: string, national: string, international: string, last4: string, country: string }}
 */
export function normalizePhone(input, countryCode) {
  const parsed = parsePhoneNumberFromString(String(input || ''), countryCode || undefined);
  if (!parsed || !parsed.isValid()) {
    throw badRequest('PHONE_INVALID', 'That phone number does not look valid.');
  }
  if (countryCode && parsed.country && parsed.country !== countryCode) {
    throw badRequest('PHONE_COUNTRY_MISMATCH', 'The phone number must belong to your country.', {
      expected: countryCode,
      got: parsed.country,
    });
  }
  return {
    e164: parsed.number,
    national: parsed.formatNational(),
    international: parsed.formatInternational(),
    last4: parsed.number.slice(-4),
    country: parsed.country,
  };
}

/** "+92 •••• 4567" — the only form we ever show back to users. */
export const maskPhone = (dial, last4) => (last4 ? `${dial ? `+${dial} ` : ''}•••• ${last4}` : null);
