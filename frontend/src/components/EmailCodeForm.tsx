// Email address + one-time code sign-in. New addresses get an account on the
// first successful code; the code is emailed by the API (Resend).
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert, Button } from './ui';

type Sent = { email: string; devCode?: string };
const RESEND_SECONDS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function EmailCodeForm({ onDone }: { onDone: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const ids = useId();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) return setError(t('errors.EMAIL_INVALID'));
    setBusy(true);
    try {
      const res = await api<Sent>('/auth/email/request', { method: 'POST', body: { email: value, language: i18n.language } });
      setSent(res);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onDone(await api<SessionResponse>('/auth/email/verify', { method: 'POST', body: { email: email.trim(), code, language: i18n.language } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form className="stack" onSubmit={requestCode} noValidate>
        <div className="field">
          <label htmlFor={`${ids}-email`}>{t('signIn.emailLabel')}</label>
          <input
            id={`${ids}-email`}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={`${ids}-hint`}
            aria-invalid={Boolean(error) || undefined}
            required
          />
          <span id={`${ids}-hint`} className="field__hint">
            {t('signIn.emailHint')}
          </span>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block loading={busy} loadingText={t('signIn.sending')} disabled={!email.trim()}>
          {t('signIn.sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={verify} noValidate>
      <p className="muted small" style={{ margin: 0 }}>
        {/* U+2066/U+2069 keep the address left-to-right inside RTL text */}
        {t('signIn.codeSentToEmail', { email: `⁦${sent.email}⁩` })}
      </p>
      {sent.devCode && <Alert kind="info">{t('signIn.devCode', { code: sent.devCode })}</Alert>}
      <div className="field">
        <label htmlFor={`${ids}-code`}>{t('signIn.codeLabel')}</label>
        <input
          id={`${ids}-code`}
          className="input input--code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-invalid={Boolean(error) || undefined}
          autoFocus
        />
        <span className="field__hint">{t('signIn.checkSpam')}</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" block loading={busy} loadingText={t('signIn.verifying')} disabled={code.length !== 6}>
        {t('signIn.verify')}
      </Button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button type="button" variant="link" onClick={() => { setSent(null); setError(null); }}>
          {t('signIn.changeEmail')}
        </Button>
        {wait > 0 ? (
          <span className="small muted" aria-live="polite">
            {t('signIn.resendIn', { seconds: wait })}
          </span>
        ) : (
          <Button type="button" variant="link" onClick={() => requestCode()} disabled={busy}>
            {t('signIn.resend')}
          </Button>
        )}
      </div>
    </form>
  );
}
