import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PhotoPicker } from '../components/PhotoPicker';
import { disablePush, enablePush, pushStatus } from '../lib/push';
import { formData } from '../lib/api';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { CountryList } from '../components/CountryList';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Alert, Button, Dialog, LoadingState } from '../components/ui';
import { getLanguage } from '../i18n/languages';
import { api, downloadJson } from '../lib/api';
import { countryName, formatDate } from '../lib/format';
import type { Me } from '../lib/types';
import { useCountries } from '../lib/useCountries';
import { useErrorMessage } from '../lib/useErrorMessage';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user, setUser, signOut } = useAuth();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!user) return null;
  const cc = user.countryCode;
  const cName = user.country ? countryName(user.country.code, user.country.name) : '';
  const cooldownUntil = user.nextCountryChangeAt && new Date(user.nextCountryChangeAt) > new Date() ? user.nextCountryChangeAt : null;

  const patch = async (key: string, body: Record<string, unknown>) => {
    setSaving(key);
    setStatus(null);
    try {
      const res = await api<{ user: Me }>('/me/settings', { method: 'PATCH', body });
      setUser(res.user);
      setStatus({ kind: 'success', text: t('app.saved') });
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setSaving(null);
    }
  };

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadJson('/me/export', 'foundback-my-data.json');
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('settings.title')}</h1>
      <div aria-live="polite">{status && <Alert kind={status.kind}>{status.text}</Alert>}</div>

      <div className="panel" style={{ marginTop: 16 }}>
        <section className="settings-section" aria-labelledby="s-profile">
          <h2 id="s-profile">{t('settings.profile')}</h2>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              void patch('name', { displayName: name.trim() });
            }}
          >
            <label htmlFor="s-name">{t('settings.displayName')}</label>
            <div className="inline-field">
              <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
              <Button type="submit" variant="ghost" loading={saving === 'name'} disabled={name.trim().length < 2 || name.trim() === user.displayName}>
                {t('app.save')}
              </Button>
            </div>
          </form>
          <div className="settings-row" style={{ marginTop: 8 }}>
            <span className="settings-row__label">{t('settings.phone')}</span>
            <bdi className="settings-row__value" dir="ltr">
              {user.phone?.masked ?? '—'}
            </bdi>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="s-region">
          <h2 id="s-region">{t('settings.languageAndRegion')}</h2>
          <div className="settings-row">
            <span className="settings-row__label">{t('settings.language')}</span>
            <LanguageSwitcher suggested={user.country?.languages ?? []} variant="light" />
          </div>
          <div className="settings-row">
            <label className="settings-row__label" htmlFor="s-units">
              {t('settings.units')}
            </label>
            <select
              id="s-units"
              className="select"
              value={user.units}
              disabled={saving === 'units'}
              onChange={(e) => void patch('units', { units: e.target.value })}
            >
              <option value="km">{t('settings.km')}</option>
              <option value="mi">{t('settings.mi')}</option>
            </select>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">{t('settings.timezone')}</span>
            <span className="settings-row__value">{user.timezone}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">{t('settings.currency')}</span>
            <span className="settings-row__value">{user.currency}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">{t('settings.city')}</span>
            <span className="settings-row__value">{user.city?.name}</span>
          </div>
          <div className="settings-row">
            <span>
              <span className="settings-row__label">{t('settings.country')}</span>
              <br />
              <span className="settings-row__value">
                {user.country?.flag} {cName}
              </span>
            </span>
            <Button variant="ghost" onClick={() => setCountryOpen(true)}>
              {t('settings.changeCountry')}
            </Button>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="s-notify">
          <h2 id="s-notify">{t('settings.notifications')}</h2>
          {(['inapp', 'email', 'push'] as const).map((k) => (
            <label key={k} className="settings-row" style={{ cursor: 'pointer' }}>
              <span className="settings-row__label">{t(`settings.notify${k === 'inapp' ? 'Inapp' : k === 'email' ? 'Email' : 'Push'}`)}</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={user.notificationPrefs[k]}
                  disabled={saving === k}
                  onChange={(e) => void patch(k, { notificationPrefs: { [k]: e.target.checked } })}
                />
                <span />
              </span>
            </label>
          ))}
        <PushRow />
        </section>

        <TravelSection />
        <IdentitySection />

        <section className="settings-section" aria-labelledby="s-privacy">
          <h2 id="s-privacy">{t('settings.privacy')}</h2>
          <p className="small muted">{t('settings.privacyBody')}</p>
          <div className="row">
            <Button variant="ghost" onClick={exportData} loading={exporting} loadingText={t('settings.downloading')}>
              {t('settings.download')}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteOpen(true)} style={{ color: 'var(--danger)' }}>
              {t('settings.delete')}
            </Button>
          </div>
        </section>

        {(user.role === 'admin' || user.role === 'moderator') && (
          <section className="settings-section">
            <Link className="btn btn--ghost btn--block" to="/admin">{t('nav.admin')}</Link>
          </section>
        )}
        <section className="settings-section">
          <Button variant="ghost" block onClick={() => void signOut()}>
            {t('settings.signOut')}
          </Button>
        </section>
      </div>

      <p className="footer-note" style={{ paddingInline: 0 }} lang={getLanguage(i18n.language).code}>
        {t('app.disclaimer')}
      </p>

      <ChangeCountryDialog open={countryOpen} onClose={() => setCountryOpen(false)} current={cc} cooldownUntil={cooldownUntil} />
      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </main>
  );
}

function ChangeCountryDialog({ open, onClose, current, cooldownUntil }: { open: boolean; onClose: () => void; current: string | null; cooldownUntil: string | null }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { countries } = useCountries();
  const errorMessage = useErrorMessage();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = countries?.find((c) => c.code === selected);

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await api<{ user: Me }>('/me/country', { method: 'POST', body: { countryCode: selected, confirm: true, timezone } });
      setUser(res.user); // onboarding is now incomplete → the app routes to /onboarding
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('settings.changeCountryTitle')} labelledBy="change-country-title">
      {cooldownUntil ? (
        <Alert kind="info">{t('settings.changeCountryCooldown', { date: formatDate(cooldownUntil, user?.countryCode, user?.timezone) })}</Alert>
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('settings.changeCountryBody')}
          </p>
          {countries ? (
            <CountryList countries={countries.filter((c) => c.code !== current)} value={selected} onSelect={setSelected} />
          ) : (
            <LoadingState />
          )}
          {error && <Alert>{error}</Alert>}
          <Button variant="danger" block onClick={confirm} loading={busy} disabled={!target}>
            {target ? t('settings.changeCountryConfirm', { country: countryName(target.code, target.name) }) : t('settings.changeCountry')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const errorMessage = useErrorMessage();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
      await signOut();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('settings.deleteTitle')} labelledBy="delete-title">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('settings.deleteBody')}
        </p>
        <div className="field">
          <label htmlFor="delete-confirm">{t('settings.deleteConfirmLabel')}</label>
          <input id="delete-confirm" className="input" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </div>
        {error && <Alert>{error}</Alert>}
        <Button variant="danger" block onClick={confirm} loading={busy} disabled={text !== 'DELETE'}>
          {t('settings.deleteConfirm')}
        </Button>
      </div>
    </Dialog>
  );
}

function PushRow() {
  const { t } = useTranslation();
  const [state, setState] = useState<'unsupported' | 'denied' | 'on' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushStatus().then(setState);
  }, []);
  if (!state || state === 'unsupported') return null;
  return (
    <div className="settings-row">
      <span>
        <span className="settings-row__label">{t('settings.pushDevice')}</span>
        <br />
        <span className="settings-row__value">{t(`settings.push.${state}`)}</span>
      </span>
      {state !== 'denied' && (
        <Button
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (state === 'on') await disablePush();
              else await enablePush();
              setState(await pushStatus());
            } finally {
              setBusy(false);
            }
          }}
        >
          {state === 'on' ? t('settings.pushOff') : t('settings.pushOn')}
        </Button>
      )}
    </div>
  );
}

function TravelSection() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { countries } = useCountries();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const refresh = async () => setUser((await api<{ user: Me }>('/me')).user);
  const turnOn = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api('/me/travel', { method: 'POST', body: { countryCode: selected } });
      await refresh();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await api('/me/travel', { method: 'DELETE' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section" aria-labelledby="s-travel">
      <h2 id="s-travel">{t('travel.title')}</h2>
      <p className="small muted">{t('travel.body')}</p>
      {user.travel ? (
        <div className="settings-row">
          <span>{t('travel.active', { country: countryName(user.travel.countryCode), date: formatDate(user.travel.until, user.countryCode) })}</span>
          <Button variant="ghost" loading={busy} onClick={turnOff}>{t('travel.turnOff')}</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>{t('travel.turnOn')}</Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('travel.pick')} labelledBy="travel-title">
        <div className="stack">
          {countries ? <CountryList countries={countries.filter((c) => c.code !== user.countryCode)} value={selected} onSelect={setSelected} /> : <LoadingState />}
          {error && <Alert>{error}</Alert>}
          <Button block loading={busy} disabled={!selected} onClick={turnOn}>{t('travel.confirm')}</Button>
        </div>
      </Dialog>
    </section>
  );
}

function IdentitySection() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<{ status: string; note: string | null } | null | undefined>(undefined);
  const [idName, setIdName] = useState('');
  const [open, setOpen] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [selfie, setSelfie] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ identity: { status: string; note: string | null } | null }>('/me/identity').then((r) => setStatus(r.identity)).catch(() => setStatus(null));
    if (user?.countryCode) api<{ country: { nationalIdName: string } }>(`/meta/countries/${user.countryCode}?lang=${i18n.language}`).then((r) => setIdName(r.country.nationalIdName)).catch(() => {});
  }, [user?.countryCode, i18n.language]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/identity', { method: 'POST', body: formData({ idNumber: idNumber.trim() }, { selfie }) });
      setStatus({ status: 'pending', note: null });
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (status === undefined) return null;
  return (
    <section className="settings-section" aria-labelledby="s-identity">
      <h2 id="s-identity">{t('identity.title')}</h2>
      <p className="small muted">{t('identity.body', { idName })}</p>
      {status?.status === 'approved' ? (
        <Alert kind="success">{t('identity.approved')}</Alert>
      ) : status?.status === 'pending' ? (
        <Alert kind="info">{t('identity.pending')}</Alert>
      ) : (
        <>
          {status?.status === 'rejected' && <Alert>{t('identity.rejected')}{status.note ? ` — ${status.note}` : ''}</Alert>}
          <Button variant="ghost" onClick={() => setOpen(true)}>{t('identity.start')}</Button>
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('identity.title')} labelledBy="identity-title">
        <div className="stack">
          <div className="field">
            <label htmlFor="idn">{t('identity.number', { idName })}</label>
            <input id="idn" className="input" dir="ltr" autoComplete="off" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={40} />
          </div>
          <div className="field">
            <span className="field__label">{t('identity.selfie', { idName })}</span>
            <PhotoPicker files={selfie} onChange={setSelfie} max={1} label={t('claim.selfieAdd')} capture="user" />
          </div>
          <p className="small muted">{t('identity.privacy')}</p>
          {error && <Alert>{error}</Alert>}
          <Button block loading={busy} disabled={idNumber.trim().length < 5 || selfie.length !== 1} onClick={submit}>{t('identity.submit')}</Button>
        </div>
      </Dialog>
    </section>
  );
}
