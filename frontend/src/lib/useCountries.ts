// Country list (public endpoint), fetched once per page load.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { CountrySummary } from './types';

let cache: CountrySummary[] | null = null;
let inflight: Promise<CountrySummary[]> | null = null;

export function loadCountries(): Promise<CountrySummary[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api<{ countries: CountrySummary[] }>('/meta/countries')
    .then((r) => (cache = r.countries))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useCountries() {
  const [countries, setCountries] = useState<CountrySummary[] | null>(cache);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => {
    setError(null);
    loadCountries().then(setCountries).catch(setError);
  }, []);
  useEffect(() => {
    if (!cache) reload();
  }, [reload]);
  return { countries, error, reload };
}

/** Country suggested from CDN geo headers or the browser locale. */
export async function suggestCountry(): Promise<string | null> {
  try {
    const r = await api<{ countryCode: string | null }>(`/meta/suggest-country?locale=${encodeURIComponent(navigator.language)}`);
    return r.countryCode;
  } catch {
    return null;
  }
}
