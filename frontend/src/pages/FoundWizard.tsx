// "I found something" — a friendly step-by-step wizard.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CategoryIcon } from '../components/CategoryArt';
import { PhotoPicker } from '../components/PhotoPicker';
import { Alert, Button, LoadingState } from '../components/ui';
import { api, formData } from '../lib/api';
import { CATEGORIES, IDENTIFIER, PRIVATE_PHOTO } from '../lib/categories';
import { countryName } from '../lib/format';
import { currentPosition } from '../lib/geo';
import type { Category, CountryConfig, FoundItem } from '../lib/types';
import { useErrorMessage } from '../lib/useErrorMessage';
import { looksSensitive, toLocalInput } from '../lib/forms';
import { withLocation } from '../lib/location';

const PinMap = lazy(() => import('../components/Maps').then((m) => ({ default: m.PinMap })));
const STEPS = ['category', 'photos', 'describe', 'questions', 'where', 'details', 'review'] as const;
type Step = (typeof STEPS)[number];

export function WizardProgress({ steps, index, prefix }: { steps: readonly string[]; index: number; prefix: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="small muted" style={{ margin: 0 }} aria-live="polite">{t('onboarding.stepOf', { current: index + 1, total: steps.length })}</p>
      <ol className="progress" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((s, i) => (
          <li key={s} data-state={i < index ? 'done' : i === index ? 'current' : 'todo'} aria-current={i === index ? 'step' : undefined}>
            <span className="progress__label">{t(`${prefix}.${s}`)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function FoundWizard() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<Category | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState([{ question: '', answer: '' }, { question: '', answer: '' }]);
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [label, setLabel] = useState('');
  const [foundAt, setFoundAt] = useState(toLocalInput(new Date()));
  const [where, setWhere] = useState<'with_me' | 'police' | 'shop_office'>('with_me');
  const [whereNote, setWhereNote] = useState('');
  const [noReward, setNoReward] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [config, setConfig] = useState<CountryConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const index = STEPS.indexOf(step);
  const center = user?.home ?? (user?.city ? { lat: user.city.lat, lng: user.city.lng } : user?.area ?? { lat: 0, lng: 0 });
  const cName = user?.country ? countryName(user.country.code, user.country.name) : '';

  useEffect(() => {
    if (user?.countryCode) api<{ country: CountryConfig }>(`/meta/countries/${user.countryCode}?lang=${i18n.language}`).then((r) => setConfig(r.country)).catch(() => {});
  }, [user?.countryCode, i18n.language]);

  const suggestions = useMemo(() => (category ? (t(`questions.${category}`, { returnObjects: true }) as unknown as string[]) : []), [category, t]);
  const idMode = category ? IDENTIFIER[category] : undefined;

  const valid: Record<Step, boolean> = {
    category: Boolean(category),
    photos: photos.length >= 1,
    describe: description.trim().length >= 3 && !looksSensitive(description) && !looksSensitive(label),
    questions:
      questions.filter((q) => q.question.trim().length >= 3 && q.answer.trim()).length >= 2 &&
      questions.every((q) => (!q.question && !q.answer) || (q.question.trim().length >= 3 && q.answer.trim())) &&
      (idMode !== 'required' || identifier.trim().length >= 3),
    where: Boolean(pin),
    details: Boolean(foundAt) && new Date(foundAt) <= new Date(),
    review: accepted,
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
        questions: questions.filter((q) => q.question.trim() && q.answer.trim()).map((q) => ({ question: q.question.trim(), answer: q.answer.trim() })),
        privateIdentifier: identifier.trim() || undefined,
        location: { ...pin, label: label.trim() || undefined },
        foundAt: new Date(foundAt).toISOString(),
        currentLocation: where,
        currentLocationNote: whereNote.trim() || undefined,
        noReward,
        guidanceAccepted: true,
      };
      // Posting needs a fresh live location inside your country.
      const r = await withLocation(() => api<{ item: FoundItem; matches: number }>('/found-items', { method: 'POST', body: formData(data, { photos }) }), setUser);
      navigate(`/items/${r.item.id}`, { replace: true, state: { posted: true, matches: r.matches } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('foundWizard.title')}</h1>
      <WizardProgress steps={STEPS} index={index} prefix="foundWizard.steps" />
      <div className="panel stack">
        {step === 'category' && (
          <fieldset className="stack">
            <legend><h2>{t('foundWizard.categoryTitle')}</h2></legend>
            <div className="category-grid">
              {CATEGORIES.map((c) => (
                <button key={c} type="button" className="category-tile" aria-pressed={category === c} onClick={() => setCategory(c)}>
                  <CategoryIcon category={c} size={26} />
                  <span>{t(`categories.${c}`)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {step === 'photos' && category && (
          <section className="stack">
            <h2>{t('foundWizard.photosTitle')}</h2>
            <p className="muted">{PRIVATE_PHOTO.has(category) ? t('foundWizard.photosPrivate') : t('foundWizard.photosPublic')}</p>
            <PhotoPicker files={photos} onChange={setPhotos} label={t('photos.add')} capture="environment" />
          </section>
        )}

        {step === 'describe' && (
          <section className="stack">
            <h2>{t('foundWizard.describeTitle')}</h2>
            <p className="muted">{t('foundWizard.describeBody')}</p>
            <div className="field">
              <label htmlFor="desc">{t('foundWizard.descriptionLabel')}</label>
              <input id="desc" className="input" maxLength={140} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('foundWizard.descriptionPlaceholder')} dir="auto" aria-invalid={looksSensitive(description) || undefined} />
              <span className="field__hint">{t('foundWizard.descriptionHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="label">{t('foundWizard.areaLabel')}</label>
              <input id="label" className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('foundWizard.areaPlaceholder')} dir="auto" />
            </div>
            {(looksSensitive(description) || looksSensitive(label)) && <Alert>{t('errors.CONTACT_DETAILS_BLOCKED')}</Alert>}
          </section>
        )}

        {step === 'questions' && category && (
          <section className="stack">
            <h2>{t('foundWizard.questionsTitle')}</h2>
            <p className="muted">{t('foundWizard.questionsBody')}</p>
            <div className="chips" aria-label={t('foundWizard.suggestions')}>
              {Array.isArray(suggestions) &&
                suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    disabled={questions.some((q) => q.question === s) || questions.every((q) => q.question) && questions.length >= 4}
                    onClick={() =>
                      setQuestions((qs) => {
                        const empty = qs.findIndex((q) => !q.question);
                        if (empty >= 0) return qs.map((q, i) => (i === empty ? { ...q, question: s } : q));
                        return qs.length < 4 ? [...qs, { question: s, answer: '' }] : qs;
                      })
                    }
                  >
                    + {s}
                  </button>
                ))}
            </div>
            {questions.map((q, i) => (
              <div key={i} className="qa">
                <div className="field">
                  <label htmlFor={`q${i}`}>{t('foundWizard.question', { n: i + 1 })}</label>
                  <input id={`q${i}`} className="input" maxLength={160} value={q.question} dir="auto" onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                </div>
                <div className="field">
                  <label htmlFor={`a${i}`}>{t('foundWizard.answer')}</label>
                  <input id={`a${i}`} className="input" maxLength={200} value={q.answer} dir="auto" autoComplete="off" onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                </div>
                {questions.length > 2 && (
                  <Button type="button" variant="link" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>{t('foundWizard.removeQuestion')}</Button>
                )}
              </div>
            ))}
            {questions.length < 4 && (
              <Button type="button" variant="ghost" onClick={() => setQuestions((qs) => [...qs, { question: '', answer: '' }])}>{t('foundWizard.addQuestion')}</Button>
            )}
            {idMode && (
              <div className="field">
                <label htmlFor="ident">
                  {category === 'national_id' || category === 'vehicle_documents'
                    ? t('foundWizard.identifierId', { name: config?.nationalIdName ?? t('categories.national_id') })
                    : t('foundWizard.identifierSerial')}
                  {idMode === 'optional' && ` (${t('app.optional')})`}
                </label>
                <input id="ident" className="input" dir="ltr" autoComplete="off" maxLength={64} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
                <span className="field__hint">{t('foundWizard.identifierHint')}</span>
              </div>
            )}
            <p className="small muted">{t('foundWizard.encryptedNote')}</p>
          </section>
        )}

        {step === 'where' && (
          <section className="stack">
            <h2>{t('foundWizard.whereTitle')}</h2>
            <p className="muted">{t('foundWizard.whereBody', { country: cName })}</p>
            <Suspense fallback={<LoadingState />}>
              <PinMap center={center} value={pin} onChange={setPin} radiusM={500} label={t('foundWizard.whereTitle')} />
            </Suspense>
            <Button
              type="button"
              variant="ghost"
              loading={locating}
              onClick={async () => {
                setLocating(true);
                try {
                  setPin(await currentPosition());
                } catch {
                  setError(t('onboarding.city.locationDenied'));
                } finally {
                  setLocating(false);
                }
              }}
            >
              {t('onboarding.city.useMyLocation')}
            </Button>
            <p className="small muted">{t('foundWizard.wherePrivacy')}</p>
          </section>
        )}

        {step === 'details' && (
          <section className="stack">
            <h2>{t('foundWizard.detailsTitle')}</h2>
            <div className="field">
              <label htmlFor="when">{t('foundWizard.when')}</label>
              <input id="when" className="input" type="datetime-local" max={toLocalInput(new Date())} value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
            </div>
            <fieldset className="choice-list">
              <legend className="field__label">{t('foundWizard.whereNow')}</legend>
              {(['with_me', 'police', 'shop_office'] as const).map((w) => (
                <label key={w} className="choice">
                  <input type="radio" name="where" checked={where === w} onChange={() => setWhere(w)} />
                  <span>{t(`item.location.${w}`)}</span>
                </label>
              ))}
            </fieldset>
            {where !== 'with_me' && (
              <div className="field">
                <label htmlFor="whereNote">{t('foundWizard.whereNote')}</label>
                <input id="whereNote" className="input" maxLength={120} value={whereNote} onChange={(e) => setWhereNote(e.target.value)} dir="auto" />
              </div>
            )}
            <label className="choice">
              <input type="checkbox" checked={noReward} onChange={(e) => setNoReward(e.target.checked)} />
              <span>{t('foundWizard.noReward')}</span>
            </label>
          </section>
        )}

        {step === 'review' && category && (
          <section className="stack">
            <h2>{t('foundWizard.reviewTitle')}</h2>
            {config && (
              <div className="alert alert--info stack" style={{ ['--gap' as string]: '6px' }}>
                <strong>{t('home.guidanceTitle', { country: cName })}</strong>
                <span>{['national_id', 'vehicle_documents'].includes(category) ? config.guidance.ids : category === 'cash' ? config.guidance.cash : ['documents', 'bank_cards'].includes(category) ? config.guidance.documents : config.guidance.general}</span>
              </div>
            )}
            <dl className="facts">
              <div><dt>{t('foundWizard.steps.category')}</dt><dd>{t(`categories.${category}`)}</dd></div>
              <div><dt>{t('foundWizard.descriptionLabel')}</dt><dd dir="auto">{description}</dd></div>
              <div><dt>{t('foundWizard.steps.photos')}</dt><dd>{t('foundWizard.photoCount', { count: photos.length })}</dd></div>
              <div><dt>{t('foundWizard.steps.questions')}</dt><dd>{t('foundWizard.questionCount', { count: questions.filter((q) => q.question && q.answer).length })}</dd></div>
              <div><dt>{t('foundWizard.whereNow')}</dt><dd>{t(`item.location.${where}`)}</dd></div>
            </dl>
            <label className="choice">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>{t('foundWizard.accept')}</span>
            </label>
          </section>
        )}

        {error && <Alert>{error}</Alert>}
        <div className="step-actions">
          {index > 0 ? <Button variant="ghost" onClick={() => go(-1)}>{t('app.back')}</Button> : <span />}
          {step === 'review' ? (
            <Button variant="accent" onClick={submit} loading={busy} loadingText={t('foundWizard.posting')} disabled={!valid.review}>{t('foundWizard.post')}</Button>
          ) : (
            <Button onClick={() => go(1)} disabled={!valid[step]}>{t('app.continue')}</Button>
          )}
        </div>
      </div>
    </main>
  );
}
