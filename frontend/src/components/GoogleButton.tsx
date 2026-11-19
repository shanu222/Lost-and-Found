// "Continue with Google" through Firebase Authentication (popup).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { completeRedirectSignIn, firebaseErrorKey, preloadFirebase, signInWithGoogle } from '../lib/firebase';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert } from './ui';

export function GoogleButton({ onSession }: { onSession: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    preloadFirebase();
    // Coming back from the redirect fallback.
    let cancelled = false;
    completeRedirectSignIn()
      .then((session) => {
        if (session && !cancelled) onSession(session);
      })
      .catch((err) => {
        if (cancelled) return;
        const key = firebaseErrorKey(err);
        setError(key ? t(key) : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      onSession(await signInWithGoogle(i18n.language));
    } catch (err) {
      const key = firebaseErrorKey(err);
      if (key !== 'firebase.cancelled') setError(key ? t(key) : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <button type="button" className="btn btn--google btn--block" onClick={go} disabled={busy} aria-busy={busy || undefined}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
          <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
        </svg>
        <span>{busy ? t('signIn.signingIn') : t('signIn.google')}</span>
      </button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
