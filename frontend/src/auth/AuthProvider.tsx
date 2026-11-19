// Session state for the whole app.
// On load we try a silent refresh (httpOnly cookie) to restore the session.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { firebaseSignOut } from '../lib/firebase';
import { api, setAccessToken, setSessionLostHandler } from '../lib/api';
import type { Me, SessionResponse } from '../lib/types';
import i18n, { setLanguage } from '../i18n';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: Me | null;
  /** Store a fresh session from sign-in. */
  acceptSession: (s: SessionResponse) => void;
  /** Replace the cached profile after an update. */
  setUser: (u: Me) => void;
  /** Change language: instant in the UI, saved to the profile when signed in. */
  changeLanguage: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const HINT = 'fb_signed_in';
/** Remembers (not secret) that this device has a session cookie. */
function sessionHint(set?: boolean): boolean {
  try {
    if (set === true) localStorage.setItem(HINT, '1');
    else if (set === false) localStorage.removeItem(HINT);
    return localStorage.getItem(HINT) === '1';
  } catch {
    return true; // storage unavailable: fall back to always trying
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<Me | null>(null);

  const setUser = useCallback((u: Me) => {
    setUserState(u);
    // The saved profile language is the user's own choice.
    if (u.language !== i18n.language) void setLanguage(u.language);
  }, []);

  const acceptSession = useCallback(
    (s: SessionResponse) => {
      setAccessToken(s.accessToken);
      setUser(s.user);
      setStatus('signedIn');
      sessionHint(true);
    },
    [setUser],
  );

  const clear = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    setStatus('signedOut');
    sessionHint(false);
  }, []);

  useEffect(() => {
    setSessionLostHandler(clear);
    // Visitors who have never signed in on this device have no refresh cookie:
    // skip the call instead of producing a 401.
    if (!sessionHint()) {
      clear();
      return;
    }
    api<SessionResponse>('/auth/refresh', { method: 'POST' })
      .then(acceptSession)
      .catch(clear);
  }, [acceptSession, clear]);

  const changeLanguage = useCallback(
    async (code: string) => {
      await setLanguage(code);
      if (user) {
        const res = await api<{ user: Me }>('/me/settings', { method: 'PATCH', body: { language: code } });
        setUserState(res.user);
      }
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await firebaseSignOut();
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ status, user, acceptSession, setUser, changeLanguage, signOut }),
    [status, user, acceptSession, setUser, changeLanguage, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
