// Email + password through Firebase Authentication: sign in, create an
// account (with email verification), and reset a forgotten password.
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  NeedsVerification,
  continueAfterVerification,
  createEmailAccount,
  firebaseErrorKey,
  resendVerification,
  sendPasswordReset,
  signInWithEmail,
} from '../lib/firebase';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert, Button } from './ui';

type Mode = 'signin' | 'signup' | 'reset' | 'verify';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function EmailPasswordForm({ onDone }: { onDone: (s: SessionResponse) => void }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const ids = useId();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      if (err instanceof NeedsVerification) {
        if (err.email) setEmail(err.email);
        setMode('verify');
      } else {
        const key = firebaseErrorKey(err);
        setError(key ? t(key) : errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) return setError(t('errors.EMAIL_INVALID'));
    if (mode === 'reset') {
      return run(async () => {
        await sendPasswordReset(value, i18n.language);
        setNotice(t('firebase.resetSent', { email: `⁦${value}⁩` }));
      });
    }
    if (password.length < 8) return setError(t('firebase.weakPassword'));
    return run(async () => {
      if (mode === 'signup') await createEmailAccount(value, password, i18n.language);
      else onDone(await signInWithEmail(value, password, i18n.language));
    });
  };

  if (mode === 'verify') {
    return (
      <div className="stack">
        <h2 className="h3" style={{ margin: 0 }}>{t('firebase.verifyTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('firebase.verifyBody', { email: `⁦${email}⁩` })}
        </p>
        {notice && <Alert kind="success">{notice}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Button block loading={busy} onClick={() => run(async () => onDone(await continueAfterVerification(i18n.language)))}>
          {t('firebase.verifiedContinue')}
        </Button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Button type="button" variant="link" onClick={() => switchTo('signin')}>
            {t('firebase.backToSignIn')}
          </Button>
          <Button type="button" variant="link" disabled={busy} onClick={() => run(async () => { await resendVerification(); setNotice(t('firebase.verificationResent')); })}>
            {t('firebase.resendVerification')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="stack signin-email" onSubmit={submit} noValidate>
      {mode !== 'reset' && (
        <div className="segmented" role="tablist" aria-label={t('firebase.emailOptions')}>
          <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} onClick={() => switchTo('signin')}>
            {t('firebase.haveAccount')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => switchTo('signup')}>
            {t('firebase.newAccount')}
          </button>
        </div>
      )}
      {mode === 'reset' && <p className="muted" style={{ margin: 0 }}>{t('firebase.resetBody')}</p>}
      <div className="field">
        <label htmlFor={`${ids}-email`}>{t('signIn.emailLabel')}</label>
        <input id={`${ids}-email`} className="input" type="email" inputMode="email" autoComplete="email" dir="ltr"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {mode !== 'reset' && (
        <div className="field">
          <label htmlFor={`${ids}-pw`}>{t('firebase.password')}</label>
          <input id={`${ids}-pw`} className="input" type="password" dir="ltr" minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          {mode === 'signup' && <span className="field__hint">{t('firebase.passwordHint')}</span>}
        </div>
      )}
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}
      <Button type="submit" block loading={busy} disabled={!email.trim() || (mode !== 'reset' && !password)}>
        {mode === 'signin' ? t('firebase.signIn') : mode === 'signup' ? t('firebase.createAccount') : t('firebase.sendReset')}
      </Button>
      {mode === 'signin' && (
        <Button type="button" variant="link" onClick={() => switchTo('reset')}>
          {t('firebase.forgot')}
        </Button>
      )}
      {mode === 'reset' && (
        <Button type="button" variant="link" onClick={() => switchTo('signin')}>
          {t('firebase.backToSignIn')}
        </Button>
      )}
    </form>
  );
}
