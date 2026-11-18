// Admin panel (admins + country moderators). Moderators only ever see the
// countries assigned to them — enforced by the API.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { LANGUAGES } from '../i18n/languages';
import { api } from '../lib/api';
import { countryName, formatDate, formatNumber } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useCountries } from '../lib/useCountries';
import { useErrorMessage } from '../lib/useErrorMessage';
import { lazy, Suspense } from 'react';
const AdminSettings = lazy(() => import('./AdminSettings'));

const TABS = ['dashboard', 'settings', 'reports', 'disputes', 'identity', 'photos', 'users', 'countries', 'moderators', 'translations', 'audit'] as const;
const ADMIN_ONLY = new Set(['settings', 'countries', 'moderators']);

export default function Admin() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tab = 'dashboard' } = useParams();
  const me = useApi<{ role: string; countries: string[] | null }>('/admin/me');
  const [country, setCountry] = useState('');
  const { countries } = useCountries();
  const errorMessage = useErrorMessage();
  if (me.error) return <main className="page" id="main"><ErrorState message={errorMessage(me.error)} onRetry={me.reload} /></main>;
  if (!me.data) return <main className="page" id="main"><LoadingState /></main>;
  const isAdmin = me.data.role === 'admin';
  const options = isAdmin ? countries ?? [] : (countries ?? []).filter((c) => me.data!.countries?.includes(c.code));
  const q = country ? `country=${country}` : '';

  return (
    <main className="page admin" id="main">
      <div className="section__head">
        <h1 style={{ margin: 0 }}>{t('admin.title')}</h1>
        <select className="select" aria-label={t('admin.countryFilter')} value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">{isAdmin ? t('admin.allCountries') : t('admin.myCountries')}</option>
          {options.map((c) => <option key={c.code} value={c.code}>{c.flag} {countryName(c.code, c.name)}</option>)}
        </select>
      </div>
      {!isAdmin && <p className="small muted">{t('admin.moderatorScope', { list: (me.data.countries ?? []).map((c) => countryName(c)).join(', ') })}</p>}
      <nav className="tabs tabs--scroll" aria-label={t('admin.title')}>
        {TABS.filter((x) => isAdmin || !ADMIN_ONLY.has(x)).map((x) => (
          <NavLink key={x} to={`/admin/${x}`} end={x === 'dashboard'} className={({ isActive }) => (isActive || (x === 'dashboard' && tab === 'dashboard') ? 'active' : '')}>
            {t(`admin.tabs.${x}`)}
          </NavLink>
        ))}
      </nav>
      {tab === 'dashboard' && <Dashboard q={q} />}
      {tab === 'reports' && <Reports q={q} />}
      {tab === 'disputes' && <Disputes q={q} />}
      {tab === 'identity' && <Identity q={q} />}
      {tab === 'photos' && <Photos q={q} />}
      {tab === 'users' && <Users q={q} selfId={user?.id} />}
      {tab === 'settings' && isAdmin && <Suspense fallback={<LoadingState />}><AdminSettings /></Suspense>}
      {tab === 'countries' && isAdmin && <Countries />}
      {tab === 'moderators' && isAdmin && <Moderators />}
      {tab === 'translations' && <Translations />}
      {tab === 'audit' && <Audit q={q} />}
    </main>
  );
}

function useAct() {
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function Wrap<T>({ state, children }: { state: { data: T | null; error: unknown; reload: () => void }; children: (d: T) => React.ReactNode }) {
  const errorMessage = useErrorMessage();
  if (state.error) return <ErrorState message={errorMessage(state.error)} onRetry={state.reload} />;
  if (!state.data) return <LoadingState />;
  return <>{children(state.data)}</>;
}

// ---------------------------------------------------------------------------
interface DashboardData {
  totals: Record<string, number>;
  perCountry: { countryCode: string; found: number; returned: number; open: number; returnRate: number; avgDaysToReturn: number | null }[];
}
function Dashboard({ q }: { q: string }) {
  const { t } = useTranslation();
  const state = useApi<DashboardData>(`/admin/dashboard?${q}`);
  return (
    <Wrap state={state}>
      {(d) => (
        <div className="stack">
          <div className="kpis">
            {(['found', 'returned', 'returnRate', 'open_claims', 'flagged_claims', 'open_reports', 'pending_identity', 'users'] as const).map((k) => (
              <div key={k} className="kpi">
                <span className="kpi__value">{k === 'returnRate' ? `${d.totals[k]}%` : formatNumber(d.totals[k] ?? 0)}</span>
                <span className="kpi__label">{t(`admin.kpi.${k}`)}</span>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.country')}</th><th>{t('admin.kpi.found')}</th><th>{t('admin.kpi.returned')}</th><th>{t('admin.kpi.returnRate')}</th><th>{t('admin.avgDays')}</th><th>{t('admin.open')}</th>
                </tr>
              </thead>
              <tbody>
                {d.perCountry.map((c) => (
                  <tr key={c.countryCode}>
                    <td>{countryName(c.countryCode)}</td><td>{c.found}</td><td>{c.returned}</td><td>{c.returnRate}%</td><td>{c.avgDaysToReturn ?? '—'}</td><td>{c.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
interface ReportRow { id: string; countryCode: string; targetType: string; targetId: string; reason: string; details: string | null; reporter: string | null; createdAt: string; target: Record<string, string> | null }
function Reports({ q }: { q: string }) {
  const { t } = useTranslation();
  const state = useApi<{ reports: ReportRow[] }>(`/admin/reports?${q}`);
  const { busy, error, run } = useAct();
  return (
    <Wrap state={state}>
      {(d) => (
        <div className="stack">
          {error && <Alert>{error}</Alert>}
          {!d.reports.length && <div className="empty"><p>{t('admin.queueEmpty')}</p></div>}
          {d.reports.map((r) => (
            <article key={r.id} className="panel stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{t(`report.reasons.${r.reason}`)} · {t(`admin.targets.${r.targetType}`)}</strong>
                <span className="small muted">{countryName(r.countryCode)} · {formatDate(r.createdAt)}</span>
              </div>
              {r.details && <p dir="auto" style={{ margin: 0 }}>{r.details}</p>}
              {r.target && <p className="small muted" dir="auto" style={{ margin: 0 }}>{r.target.description ?? r.target.body ?? r.target.display_name ?? r.target.status}</p>}
              {r.targetType === 'found_item' && <Link to={`/items/${r.targetId}`} className="small">{t('admin.openItem')}</Link>}
              <div className="row">
                <Button variant="ghost" loading={busy === `${r.id}d`} onClick={() => run(`${r.id}d`, () => api(`/admin/reports/${r.id}`, { method: 'POST', body: { action: 'dismiss' } }), state.reload)}>{t('admin.dismiss')}</Button>
                <Button variant="ghost" loading={busy === `${r.id}r`} onClick={() => run(`${r.id}r`, () => api(`/admin/reports/${r.id}`, { method: 'POST', body: { action: 'remove_content' } }), state.reload)}>{t('admin.removeContent')}</Button>
                <Button variant="danger" loading={busy === `${r.id}b`} onClick={() => run(`${r.id}b`, () => api(`/admin/reports/${r.id}`, { method: 'POST', body: { action: 'ban_user', note: r.reason } }), state.reload)}>{t('admin.banUser')}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
interface DisputeRow { id: string; countryCode: string; status: string; flags: string[]; identifierMatch: boolean | null; itemId: string; category: string; description: string; claimant: { id: string; displayName: string | null }; reportCount: number; createdAt: string }
function Disputes({ q }: { q: string }) {
  const { t } = useTranslation();
  const state = useApi<{ claims: DisputeRow[] }>(`/admin/claims?${q}`);
  const { busy, error, run } = useAct();
  return (
    <Wrap state={state}>
      {(d) => (
        <div className="stack">
          {error && <Alert>{error}</Alert>}
          {!d.claims.length && <div className="empty"><p>{t('admin.queueEmpty')}</p></div>}
          {d.claims.map((c) => (
            <article key={c.id} className="panel stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong dir="auto">{t(`categories.${c.category}`)}: {c.description}</strong>
                <span className={`status status--claim-${c.status}`}>{t(`claimStatus.${c.status}`)}</span>
              </div>
              <span className="small muted">{c.claimant.displayName} · {countryName(c.countryCode)} · {formatDate(c.createdAt)}</span>
              <div className="chips">{c.flags.map((f) => <span key={f} className="pill pill--danger">{t(`admin.flags.${f}`, { defaultValue: f })}</span>)}{c.reportCount > 0 && <span className="pill">{t('admin.reportsCount', { count: c.reportCount })}</span>}</div>
              <div className="row">
                <Link className="btn btn--ghost" to={`/admin/users?focus=${c.claimant.id}`}>{t('admin.claimHistory')}</Link>
                <Button variant="ghost" loading={busy === `${c.id}c`} onClick={() => run(`${c.id}c`, () => api(`/admin/claims/${c.id}/review`, { method: 'POST', body: { action: 'clear' } }), state.reload)}>{t('admin.clearFlag')}</Button>
                <Button variant="danger" loading={busy === `${c.id}r`} onClick={() => run(`${c.id}r`, () => api(`/admin/claims/${c.id}/review`, { method: 'POST', body: { action: 'reject' } }), state.reload)}>{t('admin.rejectClaim')}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
interface IdentityRow { id: string; countryCode: string; status: string; user: { id: string; displayName: string | null; memberSince: string }; selfieUrl: string; submittedAt: string }
function Identity({ q }: { q: string }) {
  const { t } = useTranslation();
  const state = useApi<{ checks: IdentityRow[] }>(`/admin/identity?${q}`);
  const { busy, error, run } = useAct();
  return (
    <Wrap state={state}>
      {(d) => (
        <div className="stack">
          <p className="small muted">{t('admin.identityNote')}</p>
          {error && <Alert>{error}</Alert>}
          {!d.checks.length && <div className="empty"><p>{t('admin.queueEmpty')}</p></div>}
          <div className="item-grid">
            {d.checks.map((c) => (
              <article key={c.id} className="panel stack">
                <img src={c.selfieUrl} alt={t('admin.selfieAlt', { name: c.user.displayName ?? '' })} style={{ width: '100%', borderRadius: 12 }} />
                <strong>{c.user.displayName}</strong>
                <span className="small muted">{countryName(c.countryCode)} · {formatDate(c.submittedAt)}</span>
                <div className="row">
                  <Button variant="accent" loading={busy === `${c.id}a`} onClick={() => run(`${c.id}a`, () => api(`/admin/identity/${c.id}`, { method: 'POST', body: { decision: 'approved' } }), state.reload)}>{t('admin.approve')}</Button>
                  <Button variant="ghost" loading={busy === `${c.id}r`} onClick={() => run(`${c.id}r`, () => api(`/admin/identity/${c.id}`, { method: 'POST', body: { decision: 'rejected' } }), state.reload)}>{t('admin.reject')}</Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </Wrap>
  );
}

function Photos({ q }: { q: string }) {
  const { t } = useTranslation();
  const state = useApi<{ photos: { id: string; countryCode: string; url: string; foundItemId: string | null }[] }>(`/admin/photos?${q}`);
  const { busy, error, run } = useAct();
  return (
    <Wrap state={state}>
      {(d) => (
        <div className="stack">
          {error && <Alert>{error}</Alert>}
          {!d.photos.length && <div className="empty"><p>{t('admin.queueEmpty')}</p></div>}
          <div className="item-grid">
            {d.photos.map((p) => (
              <article key={p.id} className="panel stack">
                <img src={p.url} alt="" style={{ width: '100%', borderRadius: 12 }} />
                <div className="row">
                  <Button variant="accent" loading={busy === `${p.id}a`} onClick={() => run(`${p.id}a`, () => api(`/admin/photos/${p.id}`, { method: 'POST', body: { decision: 'approved' } }), state.reload)}>{t('admin.approve')}</Button>
                  <Button variant="danger" loading={busy === `${p.id}r`} onClick={() => run(`${p.id}r`, () => api(`/admin/photos/${p.id}`, { method: 'POST', body: { decision: 'rejected' } }), state.reload)}>{t('admin.reject')}</Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
interface UserRow { id: string; displayName: string | null; countryCode: string | null; role: string; status: string; trustScore: number; returnsCount: number; claims: number; rejectedClaims: number; reports: number; phoneLast4: string | null; createdAt: string; locationCountry?: string | null; ipCountry?: string | null; vpnFlagged?: boolean }
interface UserDetail { user: UserRow & { bannedReason: string | null }; claims: { id: string; status: string; flags: string[]; identifierMatch: boolean | null; rejectReason: string | null; createdAt: string; category: string; description: string; itemId: string }[] }
function Users({ q, selfId }: { q: string; selfId?: string }) {
  const { t } = useTranslation();
  const focus = new URLSearchParams(window.location.search).get('focus');
  const [search, setSearch] = useState(focus ?? '');
  const [term, setTerm] = useState(focus ?? '');
  const state = useApi<{ users: UserRow[] }>(`/admin/users?${q}&q=${encodeURIComponent(term)}`);
  const [open, setOpen] = useState<string | null>(focus);
  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); }}>
        <input className="input" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.searchUsers')} aria-label={t('admin.searchUsers')} />
        <Button type="submit" variant="ghost">{t('admin.search')}</Button>
      </form>
      <Wrap state={state}>
        {(d) => (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('admin.name')}</th><th>{t('admin.country')}</th><th>{t('admin.statusCol')}</th><th>{t('admin.trust')}</th><th>{t('my.claims')}</th><th>{t('admin.rejected')}</th><th>{t('admin.tabs.reports')}</th><th>{t('admin.locationCol')}</th><th /></tr></thead>
              <tbody>
                {d.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.displayName ?? '—'} {u.role !== 'user' && <span className="pill">{u.role}</span>}</td>
                    <td>{u.countryCode ?? '—'}</td>
                    <td>{u.status}</td>
                    <td>{u.trustScore}</td>
                    <td>{u.claims}</td>
                    <td>{u.rejectedClaims}</td>
                    <td>{u.reports}</td>
                    <td>{u.locationCountry ?? '—'}{u.ipCountry && u.ipCountry !== u.locationCountry ? ` / IP ${u.ipCountry}` : ''}{u.vpnFlagged && <span className="pill pill--danger" style={{ marginInlineStart: 6 }}>{t('admin.vpn')}</span>}</td>
                    <td><Button variant="link" onClick={() => setOpen(u.id)} disabled={u.id === selfId}>{t('admin.details')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Wrap>
      {open && <UserDialog id={open} onClose={() => { setOpen(null); state.reload(); }} />}
    </div>
  );
}

function UserDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const state = useApi<UserDetail>(`/admin/users/${id}`);
  const { busy, error, run } = useAct();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={onClose} title={t('admin.userTitle')} labelledBy="user-dialog">
      <Wrap state={state}>
        {(d) => (
          <div className="stack">
            <p style={{ margin: 0 }}><strong>{d.user.displayName}</strong> · {d.user.countryCode} · {d.user.status}{d.user.bannedReason ? ` (${d.user.bannedReason})` : ''}</p>
            <h3 style={{ margin: 0 }}>{t('admin.claimHistory')}</h3>
            {d.claims.length ? (
              <ul className="plain-list small">
                {d.claims.map((c) => (
                  <li key={c.id}>{formatDate(c.createdAt)} · {t(`categories.${c.category}`)} · {t(`claimStatus.${c.status}`, { defaultValue: c.status })}{c.identifierMatch === false ? ` · ${t('admin.flags.identifier_mismatch')}` : ''}{c.flags.length ? ` · ${c.flags.map((f) => t(`admin.flags.${f}`, { defaultValue: f })).join(', ')}` : ''}</li>
                ))}
              </ul>
            ) : <p className="muted small">{t('admin.noClaims')}</p>}
            {error && <Alert>{error}</Alert>}
            {d.user.status === 'banned' ? (
              <Button loading={busy === 'u'} onClick={() => run('u', () => api(`/admin/users/${id}/unban`, { method: 'POST' }), state.reload)}>{t('admin.unban')}</Button>
            ) : d.user.role !== 'admin' ? (
              <>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('admin.banReason')} aria-label={t('admin.banReason')} />
                <Button variant="danger" disabled={reason.trim().length < 3} loading={busy === 'b'} onClick={() => run('b', () => api(`/admin/users/${id}/ban`, { method: 'POST', body: { reason } }), state.reload)}>{t('admin.banUser')}</Button>
              </>
            ) : null}
          </div>
        )}
      </Wrap>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
interface CountryRow {
  code: string; name: string; flag: string; enabled: boolean; currency: string; distanceUnit: 'km' | 'mi'; timezones: string[]; defaultTimezone: string;
  emergencyNumber: string; authorityName: string; nationalIdName: string; idMaskPattern: string | null;
  guidance: Record<string, Record<string, string>>; safePlaceTypes: string[]; languages: string[];
}
function Countries() {
  const { t } = useTranslation();
  const state = useApi<{ countries: CountryRow[] }>('/admin/countries');
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<CountryRow | null>(null);
  return (
    <div className="stack">
      <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('onboarding.country.search')} aria-label={t('onboarding.country.search')} />
      <Wrap state={state}>
        {(d) => (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('admin.country')}</th><th>{t('admin.enabled')}</th><th>{t('settings.currency')}</th><th>{t('admin.emergency')}</th><th>{t('admin.idName')}</th><th>{t('settings.language')}</th><th /></tr></thead>
              <tbody>
                {d.countries.filter((c) => !filter || `${c.name} ${c.code}`.toLowerCase().includes(filter.toLowerCase())).map((c) => (
                  <tr key={c.code}>
                    <td>{c.flag} {c.name}</td><td>{c.enabled ? '✓' : '—'}</td><td>{c.currency}</td><td>{c.emergencyNumber}</td><td>{c.nationalIdName}</td><td>{['en', ...c.languages].join(', ')}</td>
                    <td><Button variant="link" onClick={() => setEdit(c)}>{t('admin.edit')}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Wrap>
      {edit && <CountryDialog country={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
    </div>
  );
}

function CountryDialog({ country, onClose, onSaved }: { country: CountryRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ ...country, languagesText: country.languages.join(', ') });
  const [gLang, setGLang] = useState('en');
  const { busy, error, run } = useAct();
  const g = f.guidance[gLang] ?? {};
  const setG = (k: string, v: string) => setF((x) => ({ ...x, guidance: { ...x.guidance, [gLang]: { ...(x.guidance[gLang] ?? {}), [k]: v } } }));
  const save = () =>
    run('s', () => api(`/admin/countries/${country.code}`, {
      method: 'PATCH',
      body: {
        name: f.name, enabled: f.enabled, currency: f.currency, distanceUnit: f.distanceUnit, defaultTimezone: f.defaultTimezone,
        emergencyNumber: f.emergencyNumber, authorityName: f.authorityName, nationalIdName: f.nationalIdName,
        idMaskPattern: f.idMaskPattern || null, guidance: f.guidance, safePlaceTypes: f.safePlaceTypes,
        languages: f.languagesText.split(',').map((s) => s.trim()).filter(Boolean),
      },
    }), onSaved);
  const text = (key: keyof CountryRow, label: string) => (
    <div className="field">
      <label htmlFor={`c-${String(key)}`}>{label}</label>
      <input id={`c-${String(key)}`} className="input" value={String(f[key] ?? '')} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} />
    </div>
  );
  return (
    <Dialog open onClose={onClose} title={`${country.flag} ${country.name}`} labelledBy="country-dialog">
      <div className="stack">
        <label className="choice"><input type="checkbox" checked={f.enabled} onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))} /><span>{t('admin.enabled')}</span></label>
        {text('name', t('admin.name'))}
        {text('currency', t('settings.currency'))}
        <div className="field">
          <label htmlFor="c-unit">{t('settings.units')}</label>
          <select id="c-unit" className="select" value={f.distanceUnit} onChange={(e) => setF((x) => ({ ...x, distanceUnit: e.target.value as 'km' | 'mi' }))}>
            <option value="km">{t('settings.km')}</option><option value="mi">{t('settings.mi')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-tz">{t('settings.timezone')}</label>
          <select id="c-tz" className="select" value={f.defaultTimezone} onChange={(e) => setF((x) => ({ ...x, defaultTimezone: e.target.value }))}>
            {f.timezones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </div>
        {text('emergencyNumber', t('admin.emergency'))}
        {text('authorityName', t('admin.authority'))}
        {text('nationalIdName', t('admin.idName'))}
        {text('idMaskPattern', t('admin.idPattern'))}
        <div className="field">
          <label htmlFor="c-langs">{t('admin.languages')}</label>
          <input id="c-langs" className="input" dir="ltr" value={f.languagesText} onChange={(e) => setF((x) => ({ ...x, languagesText: e.target.value }))} />
          <span className="field__hint">{t('admin.languagesHint')}</span>
        </div>
        <fieldset className="choice-list">
          <legend className="field__label">{t('admin.safePlaceTypes')}</legend>
          {['police', 'bank', 'mall', 'station'].map((p) => (
            <label key={p} className="choice">
              <input type="checkbox" checked={f.safePlaceTypes.includes(p)} onChange={(e) => setF((x) => ({ ...x, safePlaceTypes: e.target.checked ? [...x.safePlaceTypes, p] : x.safePlaceTypes.filter((y) => y !== p) }))} />
              <span>{t(`handover.placeTypes.${p}`)}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="c-glang">{t('admin.guidanceLanguage')}</label>
          <select id="c-glang" className="select" value={gLang} onChange={(e) => setGLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
        </div>
        {(['ids', 'documents', 'cash', 'general'] as const).map((k) => (
          <div className="field" key={k}>
            <label htmlFor={`g-${k}`}>{t(`admin.guidance.${k}`)}</label>
            <textarea id={`g-${k}`} className="input" rows={2} dir="auto" value={g[k] ?? ''} onChange={(e) => setG(k, e.target.value)} />
          </div>
        ))}
        {error && <Alert>{error}</Alert>}
        <Button block loading={busy === 's'} onClick={save}>{t('app.save')}</Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function Moderators() {
  const { t } = useTranslation();
  const state = useApi<{ moderators: { userId: string; displayName: string | null; phoneLast4: string | null; homeCountry: string | null; countries: string[] }[] }>('/admin/moderators');
  const { busy, error, run } = useAct();
  const [userId, setUserId] = useState('');
  const [list, setList] = useState('');
  return (
    <div className="stack">
      <p className="small muted">{t('admin.moderatorsHelp')}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run('add', () => api(`/admin/moderators/${userId.trim()}`, { method: 'PUT', body: { countries: list.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) } }), () => { setUserId(''); setList(''); state.reload(); }); }}>
        <input className="input" style={{ flex: 2 }} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t('admin.userId')} aria-label={t('admin.userId')} dir="ltr" />
        <input className="input" style={{ flex: 1 }} value={list} onChange={(e) => setList(e.target.value)} placeholder="PK, AE" aria-label={t('admin.countriesList')} dir="ltr" />
        <Button type="submit" loading={busy === 'add'} disabled={!userId || !list}>{t('admin.assign')}</Button>
      </form>
      {error && <Alert>{error}</Alert>}
      <Wrap state={state}>
        {(d) => (
          <ul className="plain-list">
            {d.moderators.map((m) => (
              <li key={m.userId} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{m.displayName} · {m.countries.map((c) => countryName(c)).join(', ')}</span>
                <Button variant="link" loading={busy === m.userId} onClick={() => run(m.userId, () => api(`/admin/moderators/${m.userId}`, { method: 'DELETE' }), state.reload)}>{t('admin.remove')}</Button>
              </li>
            ))}
            {!d.moderators.length && <li className="muted small">{t('admin.noModerators')}</li>}
          </ul>
        )}
      </Wrap>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Translation coverage, computed from the bundled locale files.
const LOCALES = import.meta.glob<Record<string, unknown>>('../locales/*.json', { eager: true, import: 'default' });
const PLURAL = /_(zero|one|two|few|many|other)$/;
function flatten(o: Record<string, unknown>, p = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') flatten(v as Record<string, unknown>, `${p}${k}.`, out);
    else out[`${p}${k}`] = String(v ?? '');
  }
  return out;
}
function Translations() {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const en = flatten(LOCALES['../locales/en.json']);
    const bases = new Set(Object.keys(en).map((k) => k.replace(PLURAL, '')));
    return LANGUAGES.map((l) => {
      const file = flatten(LOCALES[`../locales/${l.code}.json`] ?? {});
      const done = new Set(Object.entries(file).filter(([, v]) => v.trim()).map(([k]) => k.replace(PLURAL, '')));
      const n = [...bases].filter((b) => done.has(b)).length;
      return { ...l, n, total: bases.size, pct: Math.round((n / bases.size) * 100) };
    });
  }, []);
  return (
    <div className="stack">
      <p className="small muted">{t('admin.translationsHelp')}</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('settings.language')}</th><th>{t('admin.coverage')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td><span lang={r.code}>{r.native}</span> <span className="muted small">({r.code})</span></td>
                <td style={{ minWidth: 160 }}><div className="bar"><span style={{ width: `${r.pct}%` }} /></div></td>
                <td>{r.pct}% <span className="muted small">({r.n}/{r.total})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Audit({ q }: { q: string }) {
  const { t } = useTranslation();
  const [action, setAction] = useState('');
  const state = useApi<{ entries: { id: number; countryCode: string | null; action: string; targetType: string | null; targetId: string | null; actor: string | null; at: string; meta: unknown }[] }>(`/admin/audit?${q}&action=${encodeURIComponent(action)}`);
  return (
    <div className="stack">
      <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('admin.auditFilter')} aria-label={t('admin.auditFilter')} dir="ltr" />
      <Wrap state={state}>
        {(d) => (
          <div className="table-wrap">
            <table className="table table--dense">
              <thead><tr><th>{t('admin.when')}</th><th>{t('admin.actor')}</th><th>{t('admin.action')}</th><th>{t('admin.country')}</th><th>{t('admin.target')}</th></tr></thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.actor ?? '—'}</td><td dir="ltr">{e.action}</td><td>{e.countryCode ?? '—'}</td><td dir="ltr" className="small">{e.targetType ? `${e.targetType}:${e.targetId?.slice(0, 8)}` : ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Wrap>
    </div>
  );
}
