// Phone number + one-time code, used for sign-in and for verifying a phone
// during onboarding. Validation uses libphonenumber on both client and server.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { countryName } from '../lib/format';
import type { CountrySummary } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert, Button } from './ui';

interface Props<T> {
  mode: 'signin' | 'verify';
  /** Fixed country (verify) or the initial dialling country (sign-in). */
  countryCode: string | null;
  /** Countries for the dialling-code picker (sign-in only). */
  countries?: CountrySummary[] | null;
  submitLabel?: string;
  onDone: (result: T) => void;
}

type Sent = { phone: string; devCode?: string };
const RESEND_SECONDS = 30;

export function PhoneOtpForm<T>({ mode, countryCode, countries, submitLabel, onDone }: Props<T>) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const ids = useId();
  const [cc, setCc] = useState(countryCode ?? 'PK');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (countryCode) setCc(countryCode);
  }, [countryCode]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const dialOptions = useMemo(
    () =>
      (countries ?? [])
        .filter((c) => c.dialCodes.length)
        .map((c) => ({ code: c.code, label: `${c.flag} +${c.dialCodes[0]}`, name: countryName(c.code, c.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, i18n.language)),
    [countries, i18n.language],
  );
  const fixedCountry = mode === 'verify';
  const endpoints = mode === 'signin' ? ['/auth/otp/request', '/auth/otp/verify'] : ['/me/phone/request', '/me/phone/verify'];

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const parsed = parsePhoneNumberFromString(phone, cc as CountryCode);
    if (!parsed?.isValid()) return setError(t('errors.PHONE_INVALID'));
    if (fixedCountry && parsed.country && parsed.country !== cc) return setError(t('errors.PHONE_COUNTRY_MISMATCH'));
    setBusy(true);
    try {
      const res = await api<Sent>(endpoints[0], { method: 'POST', body: { phone, countryCode: cc, language: i18n.language } });
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
      const res = await api<T>(endpoints[1], { method: 'POST', body: { phone, countryCode: cc, code, language: i18n.language } });
      onDone(res);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form className="stack" onSubmit={requestCode} noValidate>
        <div className="field">
          <label htmlFor={`${ids}-phone`}>{t('signIn.phoneLabel')}</label>
          <div className="phone-row">
            {fixedCountry || !dialOptions.length ? (
              <span className="input" style={{ width: 'auto', display: 'grid', placeItems: 'center' }}>
                {(countries ?? []).find((c) => c.code === cc)?.flag} {cc}
              </span>
            ) : (
              // The native <select> (invisible, on top) lists full country names;
              // the box underneath shows only the flag and dialling code.
              <span className="dial">
                <select className="dial__native" aria-label={t('signIn.countryCodeLabel')} value={cc} onChange={(e) => setCc(e.target.value)}>
                  {dialOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.name} ({o.label})
                    </option>
                  ))}
                </select>
                <span className="select" aria-hidden="true" style={{ display: 'flex', alignItems: 'center' }}>
                  {dialOptions.find((o) => o.code === cc)?.label}
                </span>
              </span>
            )}
            <input
              id={`${ids}-phone`}
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby={`${ids}-hint`}
              aria-invalid={Boolean(error) || undefined}
              required
            />
          </div>
          <span id={`${ids}-hint`} className="field__hint">
            {t('signIn.phoneHint')}
          </span>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" block loading={busy} loadingText={t('signIn.sending')} disabled={!phone.trim()}>
          {t('signIn.sendCode')}
        </Button>
      </form>
    );
  }

  return (
    <form className="stack" onSubmit={verify} noValidate>
      <p className="muted small" style={{ margin: 0 }}>
        {/* U+2066/U+2069 isolate the number so it reads left-to-right in RTL text */}
        {t('signIn.codeSentTo', { phone: `\u2066${sent.phone}\u2069` })}
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
      </div>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" block loading={busy} loadingText={t('signIn.verifying')} disabled={code.length !== 6}>
        {submitLabel ?? t('signIn.verify')}
      </Button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button type="button" variant="link" onClick={() => { setSent(null); setError(null); }}>
          {t('signIn.changeNumber')}
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
