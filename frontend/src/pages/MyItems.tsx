// "My items": found posts (with claims to review), lost reports (with matches
// and saved alerts) and my claims (with a status timeline).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryArt } from '../components/CategoryArt';
import { ItemCard, StatusBadge } from '../components/ItemCard';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { countryName, formatDate, formatDistance } from '../lib/format';
import type { ClaimView, FoundItem, LostReport, SavedAlert } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';

export default function MyItems() {
  const { t } = useTranslation();
  const { tab = 'found' } = useParams();
  return (
    <main className="page" id="main">
      <h1>{t('my.title')}</h1>
      <nav className="tabs" aria-label={t('my.title')}>
        <NavLink to="/my/found">{t('my.found')}</NavLink>
        <NavLink to="/my/lost">{t('my.lost')}</NavLink>
        <NavLink to="/my/claims">{t('my.claims')}</NavLink>
      </nav>
      {tab === 'lost' ? <MyLost /> : tab === 'claims' ? <MyClaims /> : <MyFound />}
    </main>
  );
}

function MyFound() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ items: FoundItem[] }>('/found-items/mine');
  if (error) return <ErrorState message={errorMessage(error)} onRetry={reload} />;
  if (!data) return <LoadingState />;
  if (!data.items.length) {
    return (
      <div className="empty">
        <p>{t('my.foundEmpty')}</p>
        <Link className="btn btn--accent" to="/found/new">{t('home.foundButton')}</Link>
      </div>
    );
  }
  return (
    <div className="stack">
      {data.items.map((i) => (
        <div key={i.id} className="my-row">
          <ItemCard item={i} />
          <div className="my-row__actions">
            {(i.pendingClaimCount ?? 0) > 0 && <span className="pill pill--accent">{t('my.claimsToReview', { count: i.pendingClaimCount })}</span>}
            {(i.matchCount ?? 0) > 0 && <span className="pill">{t('my.possibleOwners', { count: i.matchCount })}</span>}
            {(i.claimCount ?? 0) > 0 && <Link className="btn btn--ghost" to={`/my/found/${i.id}/claims`}>{t('my.reviewClaims')}</Link>}
            {i.approvedClaimId && <Link className="btn" to={`/claims/${i.approvedClaimId}/handover`}>{t('my.handover')}</Link>}
          </div>
        </div>
      ))}
    </div>
  );
}

function MyLost() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const location = useLocation() as { state?: { created?: string; matches?: number } };
  const { data, error, reload } = useApi<{ reports: LostReport[] }>('/lost-reports/mine');
  const alerts = useApi<{ alerts: SavedAlert[] }>('/alerts');
  const [alertFor, setAlertFor] = useState<LostReport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={reload} />;
  if (!data) return <LoadingState />;

  const setStatus = async (r: LostReport, status: 'found' | 'closed') => {
    setActionError(null);
    try {
      await api(`/lost-reports/${r.id}`, { method: 'PATCH', body: { status } });
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };
  const dismiss = async (r: LostReport, itemId: string) => {
    await api(`/lost-reports/${r.id}/matches/${itemId}/dismiss`, { method: 'POST' }).catch(() => {});
    reload();
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '24px' }}>
      {location.state?.created && <Alert kind="success">{t('my.lostCreated', { count: location.state.matches ?? 0 })}</Alert>}
      {actionError && <Alert>{actionError}</Alert>}
      {!data.reports.length ? (
        <div className="empty">
          <p>{t('my.lostEmpty')}</p>
          <Link className="btn btn--accent" to="/lost/new">{t('home.lostButton')}</Link>
        </div>
      ) : (
        data.reports.map((r) => (
          <section key={r.id} className="panel stack" aria-labelledby={`lr-${r.id}`}>
            <div className="lost-head">
              <CategoryArt category={r.category} className="category-art--sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="item-card__cat">{t(`categories.${r.category}`)}</span>
                <h2 id={`lr-${r.id}`} dir="auto" style={{ margin: 0, fontSize: 'var(--t-md)' }}>{r.description}</h2>
                <span className="small muted">
                  {formatDate(r.lostFrom, user?.countryCode)} – {formatDate(r.lostTo, user?.countryCode)} · {formatDistance(r.location.radiusM / 1000, user?.units ?? 'km', user?.countryCode)}
                  {r.isTravel && ` · ${t('my.traveller', { country: countryName(r.countryCode) })}`}
                </span>
              </div>
              <StatusBadge status={r.status} />
            </div>
            {r.status === 'open' && (
              <>
                <h3 style={{ margin: 0 }}>{t('my.matches')}</h3>
                {r.matches?.length ? (
                  <div className="stack" style={{ ['--gap' as string]: '10px' }}>
                    {r.matches.map((m) => (
                      <div key={m.item.id} className="my-row">
                        <ItemCard item={m.item} />
                        <div className="my-row__actions">
                          <span className="pill pill--accent">{t('my.matchScore', { score: Math.round(m.score) })}</span>
                          <Link className="btn" to={`/items/${m.item.id}`}>{t('my.viewMatch')}</Link>
                          <Button variant="link" onClick={() => dismiss(r, m.item.id)}>{t('my.notMine')}</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted small">{t('my.noMatches')}</p>
                )}
                <div className="row">
                  {!r.isTravel && <Button variant="ghost" onClick={() => setAlertFor(r)}>{t('alerts.create')}</Button>}
                  <Button variant="ghost" onClick={() => setStatus(r, 'found')}>{t('my.markFound')}</Button>
                  <Button variant="link" onClick={() => setStatus(r, 'closed')}>{t('my.closeReport')}</Button>
                </div>
              </>
            )}
          </section>
        ))
      )}

      <section className="stack" aria-labelledby="alerts-title">
        <h2 id="alerts-title">{t('alerts.title')}</h2>
        <p className="small muted">{t('alerts.body')}</p>
        {alerts.data?.alerts.length ? (
          <ul className="plain-list">
            {alerts.data.alerts.map((a) => (
              <li key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {t('alerts.line', {
                    what: [a.keywords, a.category ? t(`categories.${a.category}`) : t('alerts.anything')].filter(Boolean).join(' '),
                    distance: formatDistance(a.location.radiusM / 1000, user?.units ?? 'km', user?.countryCode),
                    place: a.label ?? '',
                    date: formatDate(a.activeUntil, user?.countryCode),
                  })}
                </span>
                <Button variant="link" onClick={async () => { await api(`/alerts/${a.id}`, { method: 'DELETE' }).catch(() => {}); alerts.reload(); }}>{t('alerts.delete')}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t('alerts.empty')}</p>
        )}
      </section>

      {alertFor && <AlertDialog report={alertFor} onClose={() => setAlertFor(null)} onCreated={() => { setAlertFor(null); alerts.reload(); }} />}
    </div>
  );
}

function AlertDialog({ report, onClose, onCreated }: { report: LostReport; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [keywords, setKeywords] = useState(report.description.split(/\s+/).slice(0, 2).join(' '));
  const [km, setKm] = useState(3);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/alerts', { method: 'POST', body: { category: report.category, keywords: keywords.trim() || undefined, location: { lat: report.location.lat, lng: report.location.lng }, radiusM: km * 1000, days, label: undefined } });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t('alerts.create')} labelledBy="alert-title">
      <div className="stack">
        <div className="field">
          <label htmlFor="kw">{t('alerts.keywords')}</label>
          <input id="kw" className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={80} dir="auto" />
          <span className="field__hint">{t('alerts.keywordsHint')}</span>
        </div>
        <div className="field">
          <label htmlFor="km">{t('alerts.radius', { distance: formatDistance(km, user?.units ?? 'km', user?.countryCode) })}</label>
          <input id="km" type="range" min={1} max={20} value={km} onChange={(e) => setKm(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="days">{t('alerts.duration')}</label>
          <select id="days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{t('alerts.days', { count: d })}</option>)}
          </select>
        </div>
        {error && <Alert>{error}</Alert>}
        <Button block loading={busy} onClick={save}>{t('alerts.save')}</Button>
      </div>
    </Dialog>
  );
}

function MyClaims() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ claims: ClaimView[] }>('/claims/mine');
  if (error) return <ErrorState message={errorMessage(error)} onRetry={reload} />;
  if (!data) return <LoadingState />;
  if (!data.claims.length) {
    return (
      <div className="empty">
        <p>{t('my.claimsEmpty')}</p>
        <Link className="btn btn--ghost" to="/browse">{t('nav.browse')}</Link>
      </div>
    );
  }
  return (
    <div className="stack">
      {data.claims.map((c) => (
        <div key={c.id} className="my-row">
          <ItemCard item={c.item} to={`/claims/${c.id}`} />
          <div className="my-row__actions">
            <span className={`status status--claim-${c.status}`}>{t(`claimStatus.${c.status}`)}</span>
            <Link className="btn btn--ghost" to={`/claims/${c.id}`}>{t('my.openClaim')}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
