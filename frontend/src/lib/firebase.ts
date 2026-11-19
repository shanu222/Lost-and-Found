// Firebase Authentication for users (Google + email/password). The Firebase
// web config comes from the API (Admin → Settings → Sign-in), so changing
// projects needs no redeploy. The SDK is loaded only when someone signs in.
import type { Auth, User } from 'firebase/auth';
import { api } from './api';
import { getAppConfig } from './appConfig';
import type { SessionResponse } from './types';

type FirebaseAuthModule = typeof import('firebase/auth');
let loaded: Promise<{ auth: Auth; m: FirebaseAuthModule }> | null = null;
let loadedFor = '';

export function firebaseConfigured() {
  const c = getAppConfig();
  return Boolean(c.firebase_api_key && c.firebase_auth_domain && c.firebase_project_id);
}

async function firebase() {
  const c = getAppConfig();
  const key = `${c.firebase_project_id}|${c.firebase_api_key}|${c.firebase_auth_domain}`;
  if (!loaded || loadedFor !== key) {
    loadedFor = key;
    loaded = (async () => {
      const [{ initializeApp, getApps, deleteApp }, m] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
      await Promise.all(getApps().map((a) => deleteApp(a))); // project changed in admin settings
      const app = initializeApp({
        apiKey: c.firebase_api_key,
        authDomain: c.firebase_auth_domain,
        projectId: c.firebase_project_id,
        appId: c.firebase_app_id || undefined,
      });
      const auth = m.initializeAuth(app, {
        persistence: [m.indexedDBLocalPersistence, m.browserLocalPersistence],
        popupRedirectResolver: m.browserPopupRedirectResolver,
      });
      return { auth, m };
    })();
    loaded.catch(() => (loaded = null));
  }
  return loaded;
}

/** Exchanges the Firebase ID token for a FoundBack session. */
async function exchange(user: User, language: string) {
  const idToken = await user.getIdToken(true);
  return api<SessionResponse>('/auth/firebase', { method: 'POST', body: { idToken, language } });
}

export class NeedsVerification extends Error {
  email: string;
  constructor(email: string) {
    super('EMAIL_NOT_VERIFIED');
    this.email = email;
  }
}

export async function signInWithGoogle(language: string) {
  const { auth, m } = await firebase();
  auth.languageCode = language;
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await m.signInWithPopup(auth, provider);
  return exchange(cred.user, language);
}

const actionSettings = () => ({ url: `${window.location.origin}/signin`, handleCodeInApp: false });

export async function signInWithEmail(email: string, password: string, language: string) {
  const { auth, m } = await firebase();
  auth.languageCode = language;
  const cred = await m.signInWithEmailAndPassword(auth, email, password);
  if (!cred.user.emailVerified) throw new NeedsVerification(cred.user.email ?? email);
  return exchange(cred.user, language);
}

export async function createEmailAccount(email: string, password: string, language: string) {
  const { auth, m } = await firebase();
  auth.languageCode = language;
  const cred = await m.createUserWithEmailAndPassword(auth, email, password);
  await m.sendEmailVerification(cred.user, actionSettings());
  throw new NeedsVerification(cred.user.email ?? email);
}

/** After the user clicked the link in the verification email. */
export async function continueAfterVerification(language: string) {
  const { auth } = await firebase();
  const user = auth.currentUser;
  if (!user) throw new Error('auth/no-current-user');
  await user.reload();
  if (!user.emailVerified) throw new NeedsVerification(user.email ?? '');
  return exchange(user, language);
}

export async function resendVerification() {
  const { auth, m } = await firebase();
  if (auth.currentUser) await m.sendEmailVerification(auth.currentUser, actionSettings());
}

export async function sendPasswordReset(email: string, language: string) {
  const { auth, m } = await firebase();
  auth.languageCode = language;
  await m.sendPasswordResetEmail(auth, email, actionSettings());
}

/** Signs out of Firebase too, so the next person on this device starts fresh. */
export async function firebaseSignOut() {
  if (!loaded) return;
  try {
    const { auth, m } = await loaded;
    await m.signOut(auth);
  } catch {
    /* ignore */
  }
}

/** Maps Firebase error codes to our translation keys. */
export function firebaseErrorKey(err: unknown): string | null {
  const code = (err as { code?: string })?.code;
  if (!code || !code.startsWith('auth/')) return null;
  const map: Record<string, string> = {
    'auth/invalid-credential': 'firebase.wrongPassword',
    'auth/wrong-password': 'firebase.wrongPassword',
    'auth/user-not-found': 'firebase.wrongPassword',
    'auth/invalid-email': 'errors.EMAIL_INVALID',
    'auth/email-already-in-use': 'firebase.emailInUse',
    'auth/weak-password': 'firebase.weakPassword',
    'auth/password-does-not-meet-requirements': 'firebase.weakPassword',
    'auth/too-many-requests': 'firebase.tooMany',
    'auth/popup-blocked': 'firebase.popupBlocked',
    'auth/popup-closed-by-user': 'firebase.cancelled',
    'auth/cancelled-popup-request': 'firebase.cancelled',
    'auth/network-request-failed': 'errors.network',
    'auth/unauthorized-domain': 'firebase.unauthorizedDomain',
    'auth/operation-not-allowed': 'firebase.notEnabled',
    'auth/account-exists-with-different-credential': 'firebase.differentMethod',
    'auth/user-disabled': 'errors.ACCOUNT_BANNED',
  };
  return map[code] ?? 'firebase.generic';
}
