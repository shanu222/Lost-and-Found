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

/** Get a live position and send it to the server. Returns the updated profile. */
export async function verifyLocation(): Promise<{ countryCode: string; user: Me }> {
  const pos = await livePosition();
  return api<{ countryCode: string; user: Me }>('/me/location', { method: 'POST', body: pos });
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
