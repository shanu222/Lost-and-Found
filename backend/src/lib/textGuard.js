// Detects (and masks) contact details and ID numbers in user text.
// Public posts that contain them are rejected; chat messages are masked.
import { findNumbers } from 'libphonenumber-js/max';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(?:com|net|org|pk|ae|uk|io|me|co|info|biz|link|ly|app)(?:\/[^\s]*)?)/gi;
const LONG_DIGITS = /(?:\d[\s-]?){9,}/g; // 9+ digits: phone, IMEI, account or ID numbers
const HANDLE = /(?:whats\s?app|wa\.me|telegram|t\.me|instagram|snapchat|signal)\s*[:@]?\s*\S*/gi;

function patterns(country) {
  const list = [EMAIL, URL, LONG_DIGITS, HANDLE];
  if (country?.id_mask_pattern) {
    try {
      list.push(new RegExp(country.id_mask_pattern, 'gi'));
    } catch {
      /* invalid admin pattern — ignore */
    }
  }
  return list;
}

function phoneRanges(text, countryCode) {
  try {
    return findNumbers(text, { defaultCountry: countryCode || undefined, v2: true }).map((n) => [n.startsAt, n.endsAt]);
  } catch {
    return [];
  }
}

/** Returns the kinds of sensitive data found (empty array = clean). */
export function findSensitive(text, country) {
  const found = new Set();
  if (!text) return [];
  if (phoneRanges(text, country?.code).length) found.add('phone');
  if (new RegExp(EMAIL.source, 'i').test(text)) found.add('email');
  if (new RegExp(URL.source, 'i').test(text)) found.add('link');
  if (new RegExp(HANDLE.source, 'i').test(text)) found.add('handle');
  if (new RegExp(LONG_DIGITS.source).test(text)) found.add('number');
  if (country?.id_mask_pattern) {
    try {
      if (new RegExp(country.id_mask_pattern, 'i').test(text)) found.add('id_number');
    } catch {
      /* ignore */
    }
  }
  return [...found];
}

/** Masks every sensitive span with "•••". Returns { text, masked }. */
export function maskSensitive(text, country) {
  let out = text;
  for (const [s, e] of phoneRanges(out, country?.code).sort((a, b) => b[0] - a[0])) out = `${out.slice(0, s)}•••${out.slice(e)}`;
  for (const re of patterns(country)) out = out.replace(new RegExp(re.source, re.flags), '•••');
  return { text: out, masked: out !== text };
}
