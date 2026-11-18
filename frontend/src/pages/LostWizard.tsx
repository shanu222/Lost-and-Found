// "I lost something" — report a lost item (home country, or travel country).
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryIcon } from '../components/CategoryArt';
import { PhotoPicker } from '../components/PhotoPicker';
import { Alert, Button, LoadingState } from '../components/ui';
import { api, formData } from '../lib/api';
import { CATEGORIES, IDENTIFIER } from '../lib/categories';
import { countryName, formatDistance } from '../lib/format';
import { looksSensitive, toLocalInput } from '../lib/forms';
import { currentPosition } from '../lib/geo';
import type { Category, LostReport } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { WizardProgress } from './FoundWizard';

const PinMap = lazy(() => import('../components/Maps').then((m) => ({ default: m.PinMap })));
const STEPS = ['category', 'describe', 'where', 'when', 'photos'] as const;
type Step = (typeof STEPS)[number];

export default function LostWizard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<Category | null>(null);
  const [description, setDescription] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [privateDetails, setPrivateDetails] = useState('');
  const [reward, setReward] = useState('');
  const [travel, setTravel] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(2);
  const [from, setFrom] = useState(toLocalInput(new Date(Date.now() - 864e5)));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = STEPS.indexOf(step);
  const center = user?.home ?? (user?.city ? { lat: user.city.lat, lng: user.city.lng } : { lat: 0, lng: 0 });
  const homeName = user?.country ? countryName(user.country.code, user.country.name) : '';
  const travelName = user?.travel ? countryName(user.travel.countryCode) : null;
  const spaceName = travel && travelName ? travelName : homeName;

  const valid: Record<Step, boolean> = {
    category: Boolean(category),
    describe: description.trim().length >= 3 && !looksSensitive(description) && (!reward || Number(reward) >= 0),
    where: Boolean(pin),
    when: Boolean(from && to) && new Date(from) <= new Date(to) && new Date(from) <= new Date(),
    photos: true,
  };

  const go = (dir: 1 | -1) => {
    setError(null);
    setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, index + dir))]);
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    if (!category || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const data = {
        category,
        description: description.trim(),
        descriptionLang: i18n.language,
        location: pin,
        radiusM: Math.round(radius * 1000),
        lostFrom: new Date(from).toISOString(),
        lostTo: new Date(to).toISOString(),
        privateDetails: privateDetails.trim() || undefined,
        identifier: identifier.trim() || undefined,
        reward: reward ? Number(reward) : undefined,
        travel,
      };
      const r = await api<{ report: LostReport; matches: number }>('/lost-reports', { method: 'POST', body: formData(data, { photos }) });
      navigate('/my/lost', { replace: true, state: { created: r.report.id, matches: r.matches } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('lostWizard.title')}</h1>
      <WizardProgress steps={STEPS} index={index} prefix="lostWizard.steps" />
      <div className="panel stack">
        {step === 'category' && (
          <fieldset className="stack">
            <legend><h2>{t('lostWizard.categoryTitle')}</h2></legend>
            <div className="category-grid">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className="category-tile" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  <CategoryIcon category={c} size={26} />
                  <span>{t(`categories.${c}`)}</span>
                </button>
              ))}
            </div>
            {user?.travel && (
              <label className="choice">
                <input type="checkbox" checked={travel} onChange={(e) => { setTravel(e.target.checked); setPin(null); }} />
                <span>{t('lostWizard.travelToggle', { country: travelName })}</span>
              </label>
            )}
          </fieldset>
        )}

        {step === 'describe' && category && (
          <section className="stack">
            <h2>{t('lostWizard.describeTitle')}</h2>
            <div className="field">
              <label htmlFor="desc">{t('lostWizard.descriptionLabel')}</label>
              <textarea id="desc" className="input" rows={3} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('lostWizard.descriptionPlaceholder')} dir="auto" />
              <span className="field__hint">{t('lostWizard.descriptionHint')}</span>
            </div>
            {looksSensitive(description) && <Alert>{t('errors.CONTACT_DETAILS_BLOCKED')}</Alert>}
            {IDENTIFIER[category] && (
              <div className="field">
                <label htmlFor="ident">{t('lostWizard.identifier')} ({t('app.optional')})</label>
                <input id="ident" className="input" dir="ltr" autoComplete="off" maxLength={64} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
                <span className="field__hint">{t('lostWizard.identifierHint')}</span>
              </div>
            )}
            <div className="field">
              <label htmlFor="private">{t('lostWizard.privateDetails')} ({t('app.optional')})</label>
              <textarea id="private" className="input" rows={2} maxLength={300} value={privateDetails} onChange={(e) => setPrivateDetails(e.target.value)} dir="auto" />
              <span className="field__hint">{t('lostWizard.privateHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="reward">{t('lostWizard.reward', { currency: user?.currency ?? '' })} ({t('app.optional')})</label>
              <input id="reward" className="input" type="number" min={0} inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} dir="ltr" />
            </div>
          </section>
        )}

        {step === 'where' && (
          <section className="stack">
            <h2>{t('lostWizard.whereTitle')}</h2>
            <p className="muted">{t('lostWizard.whereBody', { country: spaceName })}</p>
            <Suspense fallback={<LoadingState />}>
              <PinMap center={travel ? pin ?? center : center} value={pin} onChange={setPin} radiusM={radius * 1000} label={t('lostWizard.whereTitle')} />
            </Suspense>
            <div className="field">
              <label htmlFor="radius">{t('lostWizard.radius', { distance: formatDistance(radius, user?.units ?? 'km', user?.countryCode) })}</label>
              <input id="radius" type="range" min={0.5} max={20} step={0.5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </div>
            <Button type="button" variant="ghost" loading={locating} onClick={async () => {
              setLocating(true);
              try { setPin(await currentPosition()); } catch { setError(t('onboarding.city.locationDenied')); } finally { setLocating(false); }
            }}>{t('onboarding.city.useMyLocation')}</Button>
          </section>
        )}

        {step === 'when' && (
          <section className="stack">
            <h2>{t('lostWizard.whenTitle')}</h2>
            <p className="muted">{t('lostWizard.whenBody')}</p>
            <div className="field">
              <label htmlFor="from">{t('lostWizard.from')}</label>
              <input id="from" className="input" type="datetime-local" max={toLocalInput(new Date())} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="to">{t('lostWizard.to')}</label>
              <input id="to" className="input" type="datetime-local" max={toLocalInput(new Date())} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </section>
        )}

        {step === 'photos' && (
          <section className="stack">
            <h2>{t('lostWizard.photosTitle')}</h2>
            <p className="muted">{t('lostWizard.photosBody')}</p>
            <PhotoPicker files={photos} onChange={setPhotos} label={t('photos.add')} />
          </section>
        )}

        {error && <Alert>{error}</Alert>}
        <div className="step-actions">
          {index > 0 ? <Button variant="ghost" onClick={() => go(-1)}>{t('app.back')}</Button> : <span />}
          {step === 'photos' ? (
            <Button variant="accent" onClick={submit} loading={busy} loadingText={t('foundWizard.posting')}>{t('lostWizard.submit')}</Button>
          ) : (
            <Button onClick={() => go(1)} disabled={!valid[step]}>{t('app.continue')}</Button>
          )}
        </div>
      </div>
    </main>
  );
}
