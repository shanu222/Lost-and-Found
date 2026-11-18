// "Continue with Google" using Google Identity Services. Rendered only when
// VITE_GOOGLE_CLIENT_ID is set. The ID token is verified by the API.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert } from './ui';

import { useAppConfig } from '../lib/appConfig';
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gsi failed'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function GoogleButton({ onSession }: { onSession: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const slot = useRef<HTMLDivElement>(null);
  const { config } = useAppConfig();
  const CLIENT_ID = config.google_client_id || ENV_CLIENT_ID;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !slot.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async ({ credential }) => {
            setError(null);
            try {
              onSession(await api<SessionResponse>('/auth/google', { method: 'POST', body: { idToken: credential, language: i18n.language } }));
            } catch (err) {
              setError(errorMessage(err));
            }
          },
        });
        slot.current.innerHTML = '';
        window.google.accounts.id.renderButton(slot.current, {
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          width: Math.min(slot.current.clientWidth || 360, 400),
          locale: i18n.language,
        });
      })
      .catch(() => !cancelled && setError(t('errors.network')));
    return () => {
      cancelled = true;
    };
  }, [i18n.language, onSession, errorMessage, t, CLIENT_ID]);

  if (!CLIENT_ID) return null;
  return (
    <div className="stack" style={{ ['--gap' as string]: '8px' }}>
      <div ref={slot} className="google-slot" aria-label={t('signIn.google')} />
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
