import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { PhoneIcon, ShieldIcon } from '../components/Icons';
import { Alert, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { countryName, formatNumber } from '../lib/format';
import type { CountryConfig, TrustLevel } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';

const TRUST_ORDER: TrustLevel[] = ['new', 'phone_verified', 'identity_verified', 'trusted_returner'];

export default function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [stats, setStats] = useState<{ returned: number; waiting: number } | null>(null);
  const [config, setConfig] = useState<CountryConfig | null>(null);
  const [error, setError] = useState<unknown>(null);
  const cc = user?.countryCode;

  const load = useCallback(() => {
    if (!cc) return;
    setError(null);
    Promise.all([
      api<{ returned: number; waiting: number }>('/meta/stats'),
      api<{ country: CountryConfig }>(`/meta/countries/${cc}?lang=${i18n.language}`),
    ])
      .then(([s, c]) => {
        setStats(s);
        setConfig(c.country);
      })
      .catch(setError);
  }, [cc, i18n.language]);
  useEffect(load, [load]);

  if (!user || !cc) return null;
  const cName = countryName(cc, user.country?.name);
  const level = TRUST_ORDER.indexOf(user.trust.level);

  return (
    <main className="page" id="main">
      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={load} />
      ) : !stats || !config ? (
        <LoadingState />
      ) : (
        <>
          <section className="tag-hero" aria-labelledby="home-title">
            <div>
              <h1 id="home-title">{t('home.greeting', { name: user.displayName ?? '' })}</h1>
              <p>{t('home.waitingCount', { count: stats.waiting, country: cName })}</p>
            </div>
            <div className="luggage-tag">
              <span className="luggage-tag__count">{formatNumber(stats.returned, cc)}</span>
              <span className="luggage-tag__label">{t('home.returnedCount', { count: stats.returned, country: cName })}</span>
            </div>
          </section>

          <div className="home-grid">
            <section className="panel guidance" aria-labelledby="guidance-title">
              <h2 id="guidance-title">{t('home.guidanceTitle', { country: cName })}</h2>
              <dl>
                <div>
                  <dt>{t('home.guidance.ids')}</dt>
                  <dd>{config.guidance.ids}</dd>
                </div>
                <div>
                  <dt>{t('home.guidance.documents')}</dt>
                  <dd>{config.guidance.documents}</dd>
                </div>
                <div>
                  <dt>{t('home.guidance.cash')}</dt>
                  <dd>{config.guidance.cash}</dd>
                </div>
              </dl>
              <a className="emergency" href={`tel:${config.emergencyNumber}`}>
                <PhoneIcon size={18} />
                <span>{t('home.emergency', { number: config.emergencyNumber })}</span>
              </a>
            </section>

            <div className="stack">
              <section className="panel" aria-labelledby="trust-title">
                <h2 id="trust-title">{t('home.trustTitle')}</h2>
                <span className="trust-badge">
                  <ShieldIcon size={20} />
                  {t(`trust.${user.trust.level}`)}
                </span>
                <div className="trust-steps" aria-hidden="true">
                  {TRUST_ORDER.map((l, i) => (
                    <span key={l} data-on={i <= level} />
                  ))}
                </div>
                <p className="small muted">{t(`trust.next.${user.trust.level}`)}</p>
                <div className="stat-line">
                  <span>{t('home.returnsCount', { count: user.returnsCount })}</span>
                  <span>{t('home.points', { count: user.points })}</span>
                </div>
              </section>
              <Alert kind="info">
                <strong>{t('home.comingTitle')}</strong>
                <br />
                {t('home.comingBody', { country: cName })}
              </Alert>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
