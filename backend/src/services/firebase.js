// Verifies Firebase Authentication ID tokens (Google and email/password users)
// without a service account: the token is a JWT signed by Google's
// "securetoken" keys, issued for our Firebase project ID.
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { unauthorized } from '../lib/errors.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keySet = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), { cacheMaxAge: 6 * 60 * 60 * 1000 });

/** Tests only: verify against a local key set instead of Google's. */
export function __setFirebaseKeySet(ks) {
  keySet = ks;
}

/**
 * Returns { uid, email, emailVerified, name, provider } for a valid token.
 * Throws 401 for anything else (expired, wrong project, bad signature…).
 */
export async function verifyFirebaseToken(idToken, projectId) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keySet, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
      clockTolerance: 30,
    }));
  } catch {
    throw unauthorized('Sign-in failed. Please try again.');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) throw unauthorized('Sign-in failed.');
  if (typeof payload.auth_time === 'number' && payload.auth_time * 1000 > Date.now() + 30_000) throw unauthorized('Sign-in failed.');
  const provider = payload.firebase?.sign_in_provider ?? 'unknown';
  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : null,
    provider, // 'google.com' | 'password' | …
  };
}
