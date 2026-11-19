// "Continue with Google".
// Preferred: Google's own Sign in with Google button (Google Identity
// Services). It returns a Google ID token, which Firebase signs in with
// directly — no popup window, redirect or hidden iframe for browsers to block.
// Fallback (no OAuth client ID configured): Firebase's popup flow.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../lib/appConfig';
import { completeRedirectSignIn, firebaseErrorKey, preloadFirebase, signInWithGoogle, signInWithGoogleIdToken } from '../lib/firebase';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert } from './ui';

type GoogleId = {
  accounts: {
    id: {
      initialize: (o: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
      cancel: () => void;
    };
  };
};
declare global {
  interface Window {
    google?: GoogleId;
  }
}

let gisScript: Promise<GoogleId> | null = null;
function loadGis(): Promise<GoogleId> {
  gisScript ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('gis')));
    s.onerror = () => {
      gisScript = null;
      reject(new Error('gis'));
    };
    document.head.appendChild(s);
  });
  return gisScript;
}

export function GoogleButton({ onSession }: { onSession: (s: SessionResponse) => void }) {
  const { config } = useAppConfig();
  return config.google_client_id ? (
    <GisButton clientId={config.google_client_id} onSession={onSession} />
  ) : (
    <PopupButton onSession={onSession} />
  );
}

function useSignInErrors() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return (err: unknown) => {
    const key = firebaseErrorKey(err);
    return key ? t(key) : errorMessage(err);
  };
}

function GisButton({ clientId, onSession }: { clientId: string; onSession: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const describe = useSignInErrors();
  const slot = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  useEffect(() => {
    preloadFirebase();
    let alive = true;
    loadGis()
      .then((google) => {
        if (!alive || !slot.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          use_fedcm_for_button: true,
          itp_support: true,
          callback: async ({ credential }: { credential?: string }) => {
            if (!credential) return;
            setError(null);
            setBusy(true);
            try {
              onSessionRef.current(await signInWithGoogleIdToken(credential, i18n.language));
            } catch (err) {
              setError(describe(err));
              setBusy(false);
            }
          },
        });
        const width = Math.min(400, Math.max(240, Math.round(slot.current.getBoundingClientRect().width)));
        google.accounts.id.renderButton(slot.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'center',
          width,
          locale: i18n.language,
        });
      })
      .catch(() => alive && setUnavailable(true));
    return () => {
      alive = false;
      window.google?.accounts.id.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, i18n.language]);

  if (unavailable) return <PopupButton onSession={onSession} />;
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div ref={slot} className="gis-slot" aria-busy={busy || undefined} />
      {busy && <p className="small muted" style={{ margin: 0, textAlign: 'center' }} role="status">{t('signIn.signingIn')}</p>}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function PopupButton({ onSession }: { onSession: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const describe = useSignInErrors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    preloadFirebase();
    let cancelled = false;
    completeRedirectSignIn()
      .then((session) => {
        if (session && !cancelled) onSession(session);
      })
      .catch((err) => !cancelled && setError(describe(err)));
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
      if (key !== 'firebase.cancelled') setError(describe(err));
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
