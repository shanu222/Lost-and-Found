// Staff sign-in for admins and moderators: email + password, then the 6-digit
// code emailed to the staff address.
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { LogoMark, ShieldIcon } from '../components/Icons';
import { Alert, Button } from '../components/ui';
import { api } from '../lib/api';
import type { SessionResponse } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';

type Step1 = { twoFactor: true; ticket: string; sentTo: string; devCode?: string } | (SessionResponse & { twoFactor?: false });

export default function StaffLogin() {
  const { t } = useTranslation();
  const { acceptSession } = useAuth();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<{ ticket: string; sentTo: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<Step1>('/auth/admin/login', { method: 'POST', body: { email: email.trim(), password } });
      if (r.twoFactor) setTicket(r);
      else acceptSession(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      acceptSession(await api<SessionResponse>('/auth/admin/verify', { method: 'POST', body: { ticket: ticket.ticket, code } }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="staff-login" id="main">
      <div className="panel stack">
        <div className="row" style={{ gap: 10 }}>
          <LogoMark size={32} />
          <strong>{t('app.name')}</strong>
          <span className="pill" style={{ marginInlineStart: 'auto' }}><ShieldIcon size={14} /> {t('staff.badge')}</span>
        </div>
        <h1 style={{ margin: 0 }}>{t('staff.title')}</h1>
        {!ticket ? (
          <form className="stack" onSubmit={login}>
            <div className="field">
              <label htmlFor="s-email">{t('staff.email')}</label>
              <input id="s-email" className="input" type="email" autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="s-pass">{t('staff.password')}</label>
              <input id="s-pass" className="input" type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" block loading={busy} disabled={!email || !password}>{t('staff.continue')}</Button>
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            <p className="muted small" style={{ margin: 0 }}>{t('staff.codeSent', { email: `⁦${ticket.sentTo}⁩` })}</p>
            {ticket.devCode && <Alert kind="info">{t('signIn.devCode', { code: ticket.devCode })}</Alert>}
            <div className="field">
              <label htmlFor="s-code">{t('signIn.codeLabel')}</label>
              <input id="s-code" className="input input--code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
            </div>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" block loading={busy} disabled={code.length !== 6}>{t('staff.signIn')}</Button>
            <Button type="button" variant="link" onClick={() => { setTicket(null); setCode(''); setError(null); }}>{t('app.back')}</Button>
          </form>
        )}
        <p className="small muted" style={{ margin: 0 }}>{t('staff.note')}</p>
        <Link to="/signin" className="small">{t('staff.userSignIn')}</Link>
      </div>
    </main>
  );
}
