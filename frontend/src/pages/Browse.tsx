// Browse found items in the user's country: list + map, filters, newest/nearest.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ListIcon, MapIcon } from '../components/Icons';
import { ItemCard } from '../components/ItemCard';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { countryName, formatDistance } from '../lib/format';
import { currentPosition } from '../lib/geo';
import type { FoundItem } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';

const AreaMap = lazy(() => import('../components/Maps').then((m) => ({ default: m.AreaMap })));
const RADII = [1, 3, 5, 10, 25, 50];

export default function Browse() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const base = user?.home ?? (user?.city ? { lat: user.city.lat, lng: user.city.lng } : null);
  const [origin, setOrigin] = useState(base);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState(0);
  const [days, setDays] = useState(0);
  const [status, setStatus] = useState<'open' | 'returned'>('open');
  const [sort, setSort] = useState<'newest' | 'nearest'>('newest');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [items, setItems] = useState<FoundItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  // Debounce the text search.
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ status, sort, limit: view === 'map' ? '100' : '20' });
    if (category) p.set('category', category);
    if (query) p.set('q', query);
    if (origin) {
      p.set('lat', String(origin.lat));
      p.set('lng', String(origin.lng));
    }
    if (radius && origin) p.set('radiusKm', String(radius));
    if (days) p.set('from', new Date(Date.now() - days * 864e5).toISOString());
    return p;
  }, [status, sort, category, query, origin, radius, days, view]);

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams(params);
        p.set('page', String(nextPage));
        const r = await api<{ items: FoundItem[]; hasMore: boolean }>(`/found-items?${p}`);
        setItems((cur) => (nextPage === 1 ? r.items : [...(cur ?? []), ...r.items]));
        setHasMore(r.hasMore);
        setPage(nextPage);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [params],
  );
  useEffect(() => {
    void load(1);
  }, [load]);

  const locate = async () => {
    setLocating(true);
    try {
      setOrigin(await currentPosition());
      setSort('nearest');
    } catch {
      /* keep home/city */
    } finally {
      setLocating(false);
    }
  };

  const cName = user?.country ? countryName(user.country.code, user.country.name) : '';
  const units = user?.units ?? 'km';

  return (
    <main className="page" id="main">
      <div className="section__head">
        <h1 style={{ margin: 0 }}>{t('browse.title', { country: cName })}</h1>
        <div className="segmented" role="group" aria-label={t('browse.view')}>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <ListIcon size={18} /> {t('browse.list')}
          </button>
          <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
            <MapIcon size={18} /> {t('browse.map')}
          </button>
        </div>
      </div>

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <input className="input" type="search" placeholder={t('browse.search')} aria-label={t('browse.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label={t('browse.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('browse.allCategories')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{t(`categories.${c}`)}</option>
          ))}
        </select>
        <select className="select" aria-label={t('browse.radius')} value={radius} onChange={(e) => setRadius(Number(e.target.value))} disabled={!origin}>
          <option value={0}>{t('browse.anyDistance')}</option>
          {RADII.map((r) => (
            <option key={r} value={r}>{t('browse.within', { distance: formatDistance(r, units, user?.countryCode) })}</option>
          ))}
        </select>
        <select className="select" aria-label={t('browse.date')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={0}>{t('browse.anyTime')}</option>
          <option value={1}>{t('browse.lastDay')}</option>
          <option value={7}>{t('browse.lastWeek')}</option>
          <option value={30}>{t('browse.lastMonth')}</option>
        </select>
        <select className="select" aria-label={t('browse.status')} value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'returned')}>
          <option value="open">{t('browse.open')}</option>
          <option value="returned">{t('browse.returned')}</option>
        </select>
        <select className="select" aria-label={t('browse.sort')} value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'nearest')}>
          <option value="newest">{t('browse.newest')}</option>
          <option value="nearest" disabled={!origin}>{t('browse.nearest')}</option>
        </select>
        <Button type="button" variant="ghost" onClick={locate} loading={locating}>{t('browse.nearMe')}</Button>
      </form>

      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => load(1)} />
      ) : items === null ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <div className="empty">
          <p>{t('browse.empty')}</p>
          <Button variant="ghost" onClick={() => navigate('/lost/new')}>{t('home.lostButton')}</Button>
        </div>
      ) : view === 'map' ? (
        <Suspense fallback={<LoadingState />}>
          <p className="small muted">{t('browse.mapNote')}</p>
          <AreaMap
            height={480}
            center={origin ?? { lat: items[0].area.lat, lng: items[0].area.lng }}
            areas={items.map((i) => ({ id: i.id, lat: i.area.lat, lng: i.area.lng, radiusM: i.area.radiusM, title: `${t(`categories.${i.category}`)}: ${i.description}` }))}
            onSelect={(id) => navigate(`/items/${id}`)}
          />
        </Suspense>
      ) : (
        <>
          <div className="item-grid">{items.map((i) => <ItemCard key={i.id} item={i} />)}</div>
          {hasMore && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <Button variant="ghost" loading={loading} onClick={() => load(page + 1)}>{t('browse.more')}</Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
