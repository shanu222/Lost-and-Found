// Locale-aware formatting with the Intl API. The locale combines the user's
// language with their country (e.g. "ur-PK", "ar-AE", "en-GB") so dates,
// numbers and currency follow both.
import i18n from '../i18n';

export function formatLocale(countryCode?: string | null): string {
  const lang = i18n.language || 'en';
  return countryCode ? `${lang}-${countryCode}` : lang;
}

export const formatNumber = (n: number, cc?: string | null) => new Intl.NumberFormat(formatLocale(cc)).format(n);

export const formatDate = (d: string | Date, cc?: string | null, timeZone?: string | null) =>
  new Intl.DateTimeFormat(formatLocale(cc), { dateStyle: 'long', ...(timeZone ? { timeZone } : {}) }).format(new Date(d));

export const formatCurrency = (amount: number, currency: string, cc?: string | null) =>
  new Intl.NumberFormat(formatLocale(cc), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);

/** Localised country name from its ISO code (falls back to the given name). */
export function countryName(code: string, fallback?: string): string {
  try {
    return new Intl.DisplayNames([i18n.language || 'en'], { type: 'region' }).of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}

/** Distance in the user's units ("3 km" / "1.9 mi"). */
export function formatDistance(km: number, units: 'km' | 'mi', cc?: string | null): string {
  const value = units === 'mi' ? km * 0.621371 : km;
  const n = new Intl.NumberFormat(formatLocale(cc), { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  return i18n.t(`units.${units}`, { value: n });
}
