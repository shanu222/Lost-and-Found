// Live location check (GPS). The server decides the country from it and
// blocks VPN/proxy mismatches. Called before posting, claiming, travel mode
// and changing country — and whenever the API answers LOCATION_REQUIRED.
import { api, ApiError } from './api';
import type { Me } from './types';

export class LocationError extends Error {
  code: 'denied' | 'unavailable' | 'timeout' | 'unsupported';
  constructor(code: LocationError['code']) {
    super(code);
    this.code = code;
  }
}

/** Precise, fresh GPS position (never a cached one). */
export function livePosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new LocationError('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new LocationError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Location is unavailable and the connection's country is unknown: ask the user. */
export class NeedsCountryChoice extends Error {
  constructor() {
    super('COUNTRY_REQUIRED');
  }
}

export type LocationResult = { countryCode: string; user: Me; method: 'gps' | 'ip' | 'manual' };

/**
 * Confirm where the user is. Live GPS first; if the device can't share its
 * location, the server uses the internet connection's country instead
 * (a VPN still can't fake it). Throws NeedsCountryChoice when even that is
 * unknown, so the UI can let the user pick their country.
 */
export async function verifyLocation(): Promise<LocationResult> {
  let pos;
  try {
    pos = await livePosition();
  } catch (err) {
    if (!(err instanceof LocationError)) throw err;
    try {
      return await api<LocationResult>('/me/location/fallback', { method: 'POST', body: {} });
    } catch (fallbackErr) {
      if (fallbackErr instanceof ApiError && fallbackErr.code === 'COUNTRY_REQUIRED') throw new NeedsCountryChoice();
      throw err; // show the original location problem
    }
  }
  const r = await api<{ countryCode: string; user: Me }>('/me/location', { method: 'POST', body: pos });
  return { ...r, method: 'gps' };
}

/** The user's own choice, used only when location and connection are both unknown. */
export function chooseCountry(countryCode: string): Promise<LocationResult> {
  return api<LocationResult>('/me/location/fallback', { method: 'POST', body: { countryCode } });
}

/** Run `fn`; if the server needs a fresh location, verify it and retry once. */
export async function withLocation<T>(fn: () => Promise<T>, onUser?: (u: Me) => void): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'LOCATION_REQUIRED') {
      const r = await verifyLocation();
      onUser?.(r.user);
      return fn();
    }
    throw err;
  }
}
