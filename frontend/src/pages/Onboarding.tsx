// Four quick steps: country → city (+ optional home area) → phone → language & name.
// Every step saves to the server immediately, so the user can leave and resume.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CountryList } from '../components/CountryList';
import { CheckIcon, SearchIcon } from '../components/Icons';
import { LanguageOptions } from '../components/LanguageSwitcher';
import { PhoneOtpForm } from '../components/PhoneOtpForm';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { getLanguage } from '../i18n/languages';
import { api } from '../lib/api';
import { countryName, formatDistance } from '../lib/format';
import type { City, Me } from '../lib/types';
import { suggestCountry, useCountries } from '../lib/useCountries';
import { useErrorMessage } from '../lib/useErrorMessage';
import type { HomeArea } from '../components/HomeAreaMap';

const HomeAreaMap = lazy(() => import('../components/HomeAreaMap'));

const STEPS = ['country', 'city', 'phone', 'language'] as const;
type Step = (typeof STEPS)[number];

function firstIncomplete(user: Me): Step {
  const s = user.onboarding.steps;
  if (!s.country) return 'country';
  if (!s.city) return 'city';
  if (!s.phone) return 'phone';
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
        {step === 'country' && <CountryStep onNext={() => go('city')} />}
        {step === 'city' && <CityStep onBack={() => go('country')} onNext={() => go('phone')} />}
        {step === 'phone' && <PhoneStep onBack={() => go('city')} onNext={() => go('language')} />}
        {step === 'language' && <LanguageStep onBack={() => go('phone')} />}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
function CountryStep({ onNext }: { onNext: () => void }) {
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
function CityStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const errorMessage = useErrorMessage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<City[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [city, setCity] = useState<City | null>(user?.city ?? null);
  const [home, setHome] = useState<HomeArea | null>(user?.home ?? null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const country = user?.country;
  const cName = country ? countryName(country.code, country.name) : '';

  // Debounced, cancellable search scoped (server-side) to the user's country.
  useEffect(() => {
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      setSearchError(null);
      try {
        const res = await api<{ cities: City[] }>(`/meta/cities?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal });
        setResults(res.cities);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSearchError(errorMessage(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, query ? 350 : 0);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query, errorMessage]);

  const useMyLocation = () => {
    setLocError(null);
    if (!navigator.geolocation) return setLocError(t('onboarding.city.locationDenied'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setHome({ lat: p.coords.latitude, lng: p.coords.longitude, radiusKm: home?.radiusKm ?? 5 });
        setLocating(false);
      },
      () => {
        setLocError(t('onboarding.city.locationDenied'));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const save = async () => {
    if (!city) return;
    setBusy(true);
    setSaveError(null);
    try {
      const body = { ...(city.id ? { cityId: city.id } : { cityRef: city.ref }), home };
      const res = await api<{ user: Me }>('/me/onboarding/city', { method: 'POST', body });
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
        <h2 id="step-title">{t('onboarding.city.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('onboarding.city.body', { country: cName })}
        </p>
      </div>

      <div className="field">
        <label htmlFor="city-search" className="row" style={{ gap: 6 }}>
          <SearchIcon size={18} /> {t('onboarding.city.search')}
        </label>
        <input id="city-search" className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="address-level2" />
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {searchError ? (
          <Alert>{searchError}</Alert>
        ) : results === null ? (
          <LoadingState />
        ) : results.length === 0 ? (
          <p className="muted small">{t('onboarding.city.noResults', { country: cName, query })}</p>
        ) : (
          <>
            {!query && <p className="small muted" style={{ margin: '0 0 6px' }}>{t('onboarding.city.popular')}</p>}
            <ul className="option-list">
              {results.map((c) => {
                const active = city ? (c.id ? c.id === city.id : c.ref === city.ref) : false;
                return (
                  <li key={c.id ?? c.ref}>
                    <button type="button" className="option" aria-pressed={active} onClick={() => setCity(c)}>
                      <span className="option__main">
                        {c.name}
                        {c.region && <span className="option__sub">{c.region}</span>}
                      </span>
                      {active && <CheckIcon className="option__check" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {city && (
        <div className="stack" style={{ ['--gap' as string]: '10px', paddingTop: 8 }}>
          <h3 style={{ margin: 0 }}>{t('onboarding.city.homeTitle')}</h3>
          <p className="muted small" style={{ margin: 0 }}>
            {t('onboarding.city.homeBody')}
          </p>
          <Suspense fallback={<div className="map-box"><LoadingState /></div>}>
            <HomeAreaMap center={{ lat: city.lat, lng: city.lng }} value={home} onChange={setHome} label={t('onboarding.city.homeTitle')} />
          </Suspense>
          <div className="row">
            <Button type="button" variant="ghost" onClick={useMyLocation} loading={locating} loadingText={t('onboarding.city.locating')}>
              {t('onboarding.city.useMyLocation')}
            </Button>
            {home && (
              <Button type="button" variant="link" onClick={() => setHome(null)}>
                {t('onboarding.city.homeClear')}
              </Button>
            )}
          </div>
          {locError && <Alert kind="info">{locError}</Alert>}
          {home && (
            <div className="field">
              <label htmlFor="radius">{t('onboarding.city.homeRadius', { distance: formatDistance(home.radiusKm, user?.units ?? 'km', user?.countryCode) })}</label>
              <input
                id="radius"
                type="range"
                min={1}
                max={25}
                step={1}
                value={home.radiusKm}
                onChange={(e) => setHome({ ...home, radiusKm: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      )}

      {saveError && <Alert>{saveError}</Alert>}
      <div className="step-actions">
        <Button variant="ghost" onClick={onBack}>
          {t('app.back')}
        </Button>
        <Button onClick={save} loading={busy} disabled={!city}>
          {t('app.continue')}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function PhoneStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const [changing, setChanging] = useState(false);
  const { countries } = useCountries();
  if (!user) return null;
  const cName = user.country ? countryName(user.country.code, user.country.name) : '';
  const verified = user.onboarding.steps.phone && user.phone;

  return (
    <section className="stack" aria-labelledby="step-title">
      <div>
        <h2 id="step-title">{t('onboarding.phone.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t('onboarding.phone.body', { country: cName })}
        </p>
      </div>
      {verified && !changing ? (
        <>
          <div className="verified">
            <CheckIcon />
            <span>{t('onboarding.phone.verified', { phone: `⁦${user.phone!.masked}⁩` })}</span>
          </div>
          <Button variant="link" onClick={() => setChanging(true)} style={{ alignSelf: 'flex-start' }}>
            {t('onboarding.phone.useDifferent')}
          </Button>
        </>
      ) : (
        <PhoneOtpForm<{ user: Me }>
          mode="verify"
          countryCode={user.countryCode}
          countries={countries}
          submitLabel={t('onboarding.phone.verify')}
          onDone={(res) => {
            setUser(res.user);
            setChanging(false);
          }}
        />
      )}
      <div className="step-actions">
        <Button variant="ghost" onClick={onBack}>
          {t('app.back')}
        </Button>
        <Button onClick={onNext} disabled={!verified || changing}>
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
