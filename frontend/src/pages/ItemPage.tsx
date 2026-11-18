import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryArt } from '../components/CategoryArt';
import { StatusBadge } from '../components/ItemCard';
import { ReportButton } from '../components/ReportButton';
import { TranslateButton } from '../components/TranslateButton';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import type { FoundItem } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';

const AreaMap = lazy(() => import('../components/Maps').then((m) => ({ default: m.AreaMap })));

export default function ItemPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ item: FoundItem }>(`/found-items/${id}`);
  const [photo, setPhoto] = useState(0);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <main className="page" id="main"><ErrorState message={errorMessage(error)} onRetry={reload} /></main>;
  if (!data) return <main className="page" id="main"><LoadingState /></main>;
  const item = data.item;
  const catName = t(`categories.${item.category}`);

  const close = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/found-items/${item.id}`, { method: 'PATCH', body: { status: 'closed' } });
      setClosing(false);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" id="main">
      <div className="item-layout">
        <section className="item-media" aria-label={t('item.photos')}>
          {item.illustration || item.photos.length === 0 ? (
            <div className="stack" style={{ ['--gap' as string]: '8px' }}>
              <CategoryArt category={item.category} className="category-art--hero" label={catName} />
              {item.illustration && <p className="small muted">{t('item.illustrationNote')}</p>}
            </div>
          ) : (
            <>
              <img className="item-media__main" src={item.photos[photo]?.url ?? item.photos[photo]?.thumbUrl} alt={t('item.photoAlt', { n: photo + 1, category: catName })} />
              {item.photos.length > 1 && (
                <div className="item-media__thumbs">
                  {item.photos.map((p, i) => (
                    <button key={p.id} type="button" aria-pressed={i === photo} onClick={() => setPhoto(i)} aria-label={t('item.photoAlt', { n: i + 1, category: catName })}>
                      <img src={p.thumbUrl} alt="" />
                    </button>
                  ))}
                </div>
              )}
              {item.isMine && <p className="small muted">{t('item.facesBlurred')}</p>}
            </>
          )}
        </section>

        <section className="stack">
          <div className="row" style={{ gap: 8 }}>
            <span className="item-card__cat">{catName}</span>
            <StatusBadge status={item.status} />
          </div>
          <h1 dir="auto" style={{ margin: 0 }}>{item.description}</h1>
          <TranslateButton type="found_item" id={item.id} sourceLang={item.descriptionLang} />

          <dl className="facts">
            <div>
              <dt>{t('item.foundOn')}</dt>
              <dd>{formatDate(item.foundAt, user?.countryCode, user?.timezone)}</dd>
            </div>
            <div>
              <dt>{t('item.area')}</dt>
              <dd>{[item.area.label, item.area.city].filter(Boolean).join(', ') || t('item.areaApprox')}</dd>
            </div>
            <div>
              <dt>{t('item.whereNow')}</dt>
              <dd>
                {t(`item.location.${item.currentLocation}`)}
                {item.currentLocationNote && <> — <span dir="auto">{item.currentLocationNote}</span></>}
              </dd>
            </div>
            {item.noReward && (
              <div>
                <dt>{t('item.reward')}</dt>
                <dd>{t('item.noReward')}</dd>
              </div>
            )}
            {item.finder && !item.isMine && (
              <div>
                <dt>{t('item.finder')}</dt>
                <dd>{t('item.finderLine', { name: item.finder.displayName ?? t('item.someone'), count: item.finder.returnsCount })}</dd>
              </div>
            )}
          </dl>

          {item.isMine ? (
            <div className="stack" style={{ ['--gap' as string]: '10px' }}>
              <Link className="btn btn--accent" to={`/my/found/${item.id}/claims`}>
                {t('item.reviewClaims', { count: item.pendingClaimCount ?? 0 })}
              </Link>
              {['waiting', 'under_review'].includes(item.rawStatus ?? '') && (
                <Button variant="ghost" onClick={() => setClosing(true)}>{t('item.closePost')}</Button>
              )}
            </div>
          ) : item.myClaim ? (
            <Link className="btn" to={`/claims/${item.myClaim.id}`}>{t('item.viewMyClaim', { status: t(`claimStatus.${item.myClaim.status}`) })}</Link>
          ) : item.canClaim ? (
            <Button variant="accent" onClick={() => navigate(`/items/${item.id}/claim`)}>{t('item.claim')}</Button>
          ) : null}

          <Alert kind="info">{t('app.disclaimer')}</Alert>
          {!item.isMine && <ReportButton targetType="found_item" targetId={item.id} />}
        </section>
      </div>

      <section className="section" aria-labelledby="map-title">
        <h2 id="map-title">{t('item.mapTitle')}</h2>
        <p className="small muted">{t('item.mapNote')}</p>
        <Suspense fallback={<LoadingState />}>
          <AreaMap center={{ lat: item.area.lat, lng: item.area.lng }} areas={[{ id: item.id, lat: item.area.lat, lng: item.area.lng, radiusM: item.area.radiusM, title: catName }]} height={280} />
        </Suspense>
      </section>

      <Dialog open={closing} onClose={() => setClosing(false)} title={t('item.closeTitle')} labelledBy="close-title">
        <div className="stack">
          <p className="muted">{t('item.closeBody')}</p>
          {actionError && <Alert>{actionError}</Alert>}
          <Button variant="danger" block loading={busy} onClick={close}>{t('item.closePost')}</Button>
        </div>
      </Dialog>
    </main>
  );
}
