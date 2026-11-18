// Admin → Settings: live configuration of the web app and the installed app,
// including every integration key. Secrets are write-only: the server only
// ever returns "••••1234".
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';

interface SettingRow {
  key: string;
  group: string;
  type: 'boolean' | 'number' | 'string' | 'enum' | 'secret';
  options?: string[];
  min?: number;
  max?: number;
  public: boolean;
  source: 'admin' | 'env' | 'default';
  value?: string | number | boolean;
  isSet?: boolean;
  masked?: string;
}

const GROUPS = ['general', 'features', 'security', 'limits', 'email', 'sms', 'signin', 'ai', 'location', 'push', 'storage'];
type Value = string | number | boolean | null;

export default function AdminSettings() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, reload, setData } = useApi<{ settings: SettingRow[] }>('/admin/settings');
  const [changes, setChanges] = useState<Record<string, Value>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const grouped = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const g of GROUPS) map.set(g, []);
    for (const s of data?.settings ?? []) map.get(s.group)?.push(s);
    return map;
  }, [data]);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={reload} />;
  if (!data) return <LoadingState />;
  const dirty = Object.keys(changes).length > 0;
  const set = (key: string, v: Value) => setChanges((c) => ({ ...c, [key]: v }));
  const valueOf = (s: SettingRow) => (s.key in changes ? changes[s.key] : s.value);

  const save = async () => {
    setBusy('save');
    setStatus(null);
    try {
      const r = await api<{ settings: SettingRow[] }>('/admin/settings', { method: 'PATCH', body: { changes } });
      setData(r);
      setChanges({});
      setStatus({ kind: 'success', text: t('adminSettings.saved') });
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const test = async (kind: 'email' | 'ai') => {
    setBusy(kind);
    setStatus(null);
    try {
      const r = await api<{ to?: string; provider?: string; sample?: string }>(`/admin/settings/test-${kind}`, { method: 'POST' });
      setStatus({ kind: 'success', text: kind === 'email' ? t('adminSettings.testEmailOk', { to: r.to }) : t('adminSettings.testAiOk', { provider: r.provider, sample: r.sample }) });
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const control = (s: SettingRow) => {
    const id = `set-${s.key}`;
    const v = valueOf(s);
    switch (s.type) {
      case 'boolean':
        return (
          <span className="switch">
            <input id={id} type="checkbox" checked={Boolean(v)} onChange={(e) => set(s.key, e.target.checked)} />
            <span />
          </span>
        );
      case 'number':
        return <input id={id} className="input" type="number" min={s.min} max={s.max} value={String(v ?? '')} onChange={(e) => set(s.key, e.target.value === '' ? null : Number(e.target.value))} dir="ltr" />;
      case 'enum':
        return (
          <select id={id} className="select" value={String(v ?? '')} onChange={(e) => set(s.key, e.target.value)}>
            {s.options?.map((o) => <option key={o} value={o}>{t(`adminSettings.options.${o}`, { defaultValue: o })}</option>)}
          </select>
        );
      case 'secret':
        return (
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <span className="small" dir="ltr">{s.isSet ? s.masked : t('adminSettings.notSet')}</span>
            <div className="inline-field">
              <input
                id={id}
                className="input"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                placeholder={s.isSet ? t('adminSettings.replace') : t('adminSettings.enterKey')}
                value={typeof changes[s.key] === 'string' ? String(changes[s.key]) : ''}
                onChange={(e) => (e.target.value ? set(s.key, e.target.value) : setChanges(({ [s.key]: _drop, ...rest }) => rest))}
              />
              {s.isSet && s.source === 'admin' && (
                <Button type="button" variant="ghost" onClick={() => set(s.key, null)}>{t('adminSettings.clear')}</Button>
              )}
            </div>
            {changes[s.key] === null && <span className="small muted">{t('adminSettings.willClear')}</span>}
          </div>
        );
      default:
        return s.key.endsWith('message') || s.key === 'announcement' ? (
          <textarea id={id} className="input" rows={2} value={String(v ?? '')} onChange={(e) => set(s.key, e.target.value)} dir="auto" />
        ) : (
          <input id={id} className="input" value={String(v ?? '')} onChange={(e) => set(s.key, e.target.value)} dir="ltr" />
        );
    }
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '20px' }}>
      <Alert kind="info">{t('adminSettings.intro')}</Alert>
      {GROUPS.map((g) => (
        <section key={g} className="panel" aria-labelledby={`g-${g}`}>
          <div className="section__head" style={{ marginBottom: 4 }}>
            <h2 id={`g-${g}`} style={{ margin: 0 }}>{t(`adminSettings.groups.${g}`)}</h2>
            {g === 'email' && <Button variant="ghost" loading={busy === 'email'} onClick={() => test('email')}>{t('adminSettings.testEmail')}</Button>}
            {g === 'ai' && <Button variant="ghost" loading={busy === 'ai'} onClick={() => test('ai')}>{t('adminSettings.testAi')}</Button>}
          </div>
          <p className="small muted" style={{ margin: '0 0 8px' }}>{t(`adminSettings.groupHelp.${g}`)}</p>
          <div className="settings-grid">
            {grouped.get(g)?.map((s) => (
              <div key={s.key} className="setting-row">
                <label htmlFor={`set-${s.key}`} className="setting-row__label">
                  <strong>
                    {t(`adminSettings.keys.${s.key}`, { defaultValue: s.key })}
                    <span className={`source-tag ${s.source === 'admin' ? 'source-tag--admin' : ''}`}>{t(`adminSettings.source.${s.source}`)}</span>
                  </strong>
                  <span dir="ltr">{s.key}{s.public ? ` · ${t('adminSettings.public')}` : ''}</span>
                </label>
                <div>{control(s)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <AccountPassword />
      {(dirty || status) && (
      <div className="sticky-save">
        {status && <Alert kind={status.kind}>{status.text}</Alert>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dirty && <Button variant="ghost" onClick={() => setChanges({})}>{t('app.cancel')}</Button>}
          <Button variant="accent" disabled={!dirty} loading={busy === 'save'} onClick={save}>
            {t('adminSettings.save', { count: Object.keys(changes).length })}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

function AccountPassword() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const strong = next.length >= 10 && /[a-z]/.test(next) && /[A-Z]/.test(next) && /\d/.test(next) && /[^A-Za-z0-9]/.test(next);
  const change = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api('/admin/account/password', { method: 'POST', body: { current, next } });
      setStatus({ kind: 'success', text: t('adminSettings.passwordChanged') });
      setCurrent('');
      setNext('');
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack" aria-labelledby="acct">
      <h2 id="acct" style={{ margin: 0 }}>{t('adminSettings.accountTitle')}</h2>
      <div className="field">
        <label htmlFor="pw-cur">{t('adminSettings.currentPassword')}</label>
        <input id="pw-cur" className="input" type="password" autoComplete="current-password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw-new">{t('adminSettings.newPassword')}</label>
        <input id="pw-new" className="input" type="password" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} />
        <span className="field__hint">{t('adminSettings.passwordRules')}</span>
      </div>
      {status && <Alert kind={status.kind}>{status.text}</Alert>}
      <Button onClick={change} loading={busy} disabled={!strong}>{t('adminSettings.changePassword')}</Button>
    </section>
  );
}
