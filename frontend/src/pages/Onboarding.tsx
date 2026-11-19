// Two quick steps: country (detected from live location; the city follows
// from it automatically) → language & name.
// Every step saves to the server immediately, so the user can leave and resume.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CountryList } from '../components/CountryList';
import { LanguageOptions } from '../components/LanguageSwitcher';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { getLanguage } from '../i18n/languages';
import { api } from '../lib/api';
import { countryName } from '../lib/format';
import type { Me } from '../lib/types';
import { suggestCountry, useCountries } from '../lib/useCountries';
import { useErrorMessage } from '../lib/useErrorMessage';
import { LocationPrompt } from '../components/LocationPrompt';
import { useAppConfig } from '../lib/appConfig';

const STEPS = ['country', 'language'] as const;
type Step = (typeof STEPS)[number];

function firstIncomplete(user: Me): Step {
  const s = user.onboarding.steps;
  if (!s.country) return 'country';
  return 'language';
}

export default function Onboarding() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(() => (user ? firstIncomplete(user) : 'country'));
  if (!user) return null;
  const index = STEPS.indexOf(step);
  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="page page--narrow" id="main">
      <h1 className="visually-hidden">{t('onboarding.title')}</h1>
      <p className="small muted" style={{ margin: 0 }} aria-live="polite">
        {t('onboarding.stepOf', { current: index + 1, total: STEPS.length })}
      </p>
      <ol className="progress">
        {STEPS.map((s, i) => (
          <li key={s} data-state={i < index ? 'done' : i === index ? 'current' : 'todo'} aria-current={i === index ? 'step' : undefined}>
            {t(`onboarding.steps.${s}`)}
          </li>
        ))}
      </ol>
      <div className="panel">
        {step === 'country' && <CountryStep onNext={() => go('language')} />}
        {step === 'language' && <LanguageStep onBack={() => go('country')} />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
function CountryStep({ onNext }: { onNext: () => void }) {
  const { config } = useAppConfig();
  return config.require_live_location ? <LiveCountryStep onNext={onNext} /> : <PickCountryStep onNext={onNext} />;
}

/** Country decided by the device's live GPS location (default). */
function LiveCountryStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const errorMessage = useErrorMessage();
  const [detected, setDetected] = useState<string | null>(user?.location.fresh ? user.location.countryCode : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api<{ user: Me }>('/me/onboarding/country', { method: 'POST', body: { timezone } });
      setUser(res.user);
      onNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="step-title">
      <div>
        <h2 id="step-title">{t('onboarding.country.liveTitle')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('onboarding.country.liveBody')}</p>
      </div>
      <LocationPrompt onVerified={setDetected} />
      {error && <Alert>{error}</Alert>}
      <div className="step-actions">
        <Button onClick={save} loading={busy} disabled={!detected}>
          {detected ? t('onboarding.country.continueIn', { country: countryName(detected) }) : t('app.continue')}
        </Button>
      </div>
    </section>
  );
}

/** Manual country choice — only when an admin turns live location off. */
function PickCountryStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { countries, error, reload } = useCountries();
  const errorMessage = useErrorMessage();
  const [selected, setSelected] = useState<string | null>(user?.countryCode ?? null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void suggestCountry().then((c) => {
      setSuggested(c);
      setSelected((cur) => cur ?? c);
    });
  }, []);

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setSaveError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api<{ user: Me }>('/me/onboarding/country', { method: 'POST', body: { countryCode: selected, timezone } });
      setUser(res.user);
      onNext();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="step-title">
      <div>
        <h2 id="step-title">{t('onboarding.country.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('onboarding.country.body')}
        </p>
      </div>
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={reload} />
      ) : !countries ? (
        <LoadingState />
      ) : (
        <CountryList countries={countries} value={selected} suggested={suggested} onSelect={setSelected} />
      )}
      {saveError && <Alert>{saveError}</Alert>}
      <div className="step-actions">
        <Button onClick={save} loading={busy} disabled={!selected}>
          {t('app.continue')}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function LanguageStep({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, setUser, changeLanguage } = useAuth();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.displayName ?? '');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggested = useMemo(() => ['en', ...(user?.country?.languages ?? [])].map(getLanguage), [user?.country?.languages]);
  const hasOther = !suggested.some((l) => l.code === i18n.language);

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/settings', { method: 'PATCH', body: { displayName: name.trim(), language: i18n.language } });
      const res = await api<{ user: Me }>('/me/onboarding/complete', { method: 'POST' });
      setUser(res.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section className="stack" aria-labelledby="step-title">
      <div>
        <h2 id="step-title">{t('onboarding.language.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('onboarding.language.body')}
        </p>
      </div>
      <div className="lang-tiles" role="group" aria-labelledby="step-title">
        {[...suggested, ...(hasOther ? [getLanguage(i18n.language)] : [])].map((l) => (
          <button key={l.code} type="button" className="lang-tile" aria-pressed={i18n.language === l.code} onClick={() => changeLanguage(l.code)}>
            <strong lang={l.code} dir={l.dir}>
              {l.native}
            </strong>
            <span className="small muted">{l.name}</span>
          </button>
        ))}
      </div>
      <Button variant="link" onClick={() => setMore(true)} style={{ alignSelf: 'flex-start' }}>
        {t('onboarding.language.more')}
      </Button>
      <Dialog open={more} onClose={() => setMore(false)} title={t('language.title')} labelledBy="more-lang-title">
        <LanguageOptions suggested={user?.country?.languages ?? []} onPicked={() => setMore(false)} />
      </Dialog>

      <div className="field">
        <label htmlFor="display-name">{t('onboarding.language.nameLabel')}</label>
        <input
          id="display-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoComplete="given-name"
          aria-describedby="display-name-hint"
        />
        <span id="display-name-hint" className="field__hint">
          {t('onboarding.language.nameHint')}
        </span>
      </div>

      {error && <Alert>{error}</Alert>}
      <div className="step-actions">
        <Button variant="ghost" onClick={onBack}>
          {t('app.back')}
        </Button>
        <Button variant="accent" onClick={finish} loading={busy} disabled={name.trim().length < 2}>
          {t('onboarding.language.finish')}
        </Button>
      </div>
    </section>
  );
}
