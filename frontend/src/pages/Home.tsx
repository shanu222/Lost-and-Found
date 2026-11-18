import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryIcon } from '../components/CategoryArt';
import { PhoneIcon, ShieldIcon } from '../components/Icons';
import { ItemCard } from '../components/ItemCard';
import { ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { countryName, formatNumber } from '../lib/format';
import type { CountryConfig, FoundItem, Story, TrustLevel } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';

const TRUST_ORDER: TrustLevel[] = ['new', 'phone_verified', 'identity_verified', 'trusted_returner'];

export default function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [stats, setStats] = useState<{ returned: number; waiting: number } | null>(null);
  const [config, setConfig] = useState<CountryConfig | null>(null);
  const [near, setNear] = useState<FoundItem[] | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState<unknown>(null);
  const cc = user?.countryCode;
  const origin = user?.home ?? (user?.city ? { lat: user.city.lat, lng: user.city.lng } : null);

  const load = useCallback(() => {
    if (!cc) return;
    setError(null);
    const nearQuery = origin ? `&sort=nearest&lat=${origin.lat}&lng=${origin.lng}&radiusKm=${user?.home?.radiusKm ?? 15}` : '';
    Promise.all([
      api<{ returned: number; waiting: number }>('/meta/stats'),
      api<{ country: CountryConfig }>(`/meta/countries/${cc}?lang=${i18n.language}`),
      api<{ items: FoundItem[] }>(`/found-items?limit=6${nearQuery}`),
      api<{ stories: Story[] }>('/stories').catch(() => ({ stories: [] })),
    ])
      .then(([s, c, n, st]) => {
        setStats(s);
        setConfig(c.country);
        setNear(n.items);
        setStories(st.stories);
      })
      .catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc, i18n.language, origin?.lat, origin?.lng]);
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

          <div className="big-actions">
            <Link to="/found/new" className="big-action big-action--found">
              <strong>{t('home.foundButton')}</strong>
              <span>{t('home.foundHint')}</span>
            </Link>
            <Link to="/lost/new" className="big-action big-action--lost">
              <strong>{t('home.lostButton')}</strong>
              <span>{t('home.lostHint')}</span>
            </Link>
          </div>

          <section className="section" aria-labelledby="near-title">
            <div className="section__head">
              <h2 id="near-title">{t('home.nearTitle')}</h2>
              <Link to="/browse" className="small">{t('home.seeAll')}</Link>
            </div>
            {near && near.length ? (
              <div className="item-grid">{near.map((i) => <ItemCard key={i.id} item={i} />)}</div>
            ) : (
              <div className="empty">
                <p>{t('home.nearEmpty')}</p>
                <Link to="/lost/new" className="btn btn--ghost">{t('home.lostButton')}</Link>
              </div>
            )}
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
              {stories.length > 0 && (
                <section className="panel" aria-labelledby="stories-title">
                  <h2 id="stories-title">{t('home.storiesTitle')}</h2>
                  <ul className="stories">
                    {stories.slice(0, 4).map((s) => (
                      <li key={s.id}>
                        <blockquote dir="auto">“{s.note}”</blockquote>
                        <span className="small muted row" style={{ gap: 6 }}>
                          <CategoryIcon category={s.category} size={16} />
                          {t('home.storyMeta', { category: t(`categories.${s.category}`), city: s.city ?? cName, count: s.days })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
