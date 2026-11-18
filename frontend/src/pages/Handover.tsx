// Handover: both agree → choose method + safe place → owner shows a 6-digit
// code / QR → finder enters or scans it → "Returned" → both rate each other.
import QRCode from 'qrcode';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CheckIcon, QrIcon } from '../components/Icons';
import { Alert, Button, ErrorState, LoadingState } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, formatDistance } from '../lib/format';
import { toLocalInput } from '../lib/forms';
import type { Handover as H, SafePlace } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';

const PlacesMap = lazy(() => import('../components/Maps').then((m) => ({ default: m.PlacesMap })));

export default function Handover() {
  const { id } = useParams();
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, reload, setData } = useApi<{ handover: H }>(`/claims/${id}/handover`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error) return <main className="page page--narrow" id="main"><ErrorState message={errorMessage(error)} onRetry={reload} /></main>;
  if (!data) return <main className="page page--narrow" id="main"><LoadingState /></main>;
  const h = data.handover;

  const call = async (path: string, method: 'POST' | 'PUT', body?: unknown) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<{ handover: H }>(`/claims/${id}/handover${path}`, { method, body });
      setData(r);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('handover.title', { category: t(`categories.${h.category}`) })}</h1>
      {actionError && <Alert>{actionError}</Alert>}

      {h.completedAt ? (
        <Completed h={h} onRated={reload} />
      ) : !h.bothAgreed ? (
        <section className="panel stack">
          <h2>{t('handover.agreeTitle')}</h2>
          <p className="muted">{t(h.role === 'finder' ? 'handover.agreeBodyFinder' : 'handover.agreeBodyOwner')}</p>
          <ul className="checklist">
            <li data-done={h.finderAgreed}>{t('handover.finderAgreed')}</li>
            <li data-done={h.ownerAgreed}>{t('handover.ownerAgreed')}</li>
          </ul>
          {(h.role === 'finder' ? !h.finderAgreed : !h.ownerAgreed) ? (
            <Button variant="accent" loading={busy} onClick={() => call('/agree', 'POST')}>{t('handover.agree')}</Button>
          ) : (
            <Alert kind="info">{t('handover.waitingOther')}</Alert>
          )}
        </section>
      ) : (
        <>
          <CodeSection h={h} busy={busy} onComplete={(code) => call('/complete', 'POST', { code })} />
          <PlanSection h={h} busy={busy} onSave={(body) => call('', 'PUT', body)} />
        </>
      )}
      <p className="footer-note" style={{ paddingInline: 0 }}>{t('app.disclaimer')}</p>
    </main>
  );
}

function CodeSection({ h, busy, onComplete }: { h: H; busy: boolean; onComplete: (code: string) => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (h.code && canvas.current) QRCode.toCanvas(canvas.current, `FOUNDBACK:${h.code}`, { width: 220, margin: 1, color: { dark: '#0a3436', light: '#ffffff' } });
  }, [h.code]);

  // QR scanning with the BarcodeDetector API where available (Chrome/Android).
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      setScanError(t('handover.scanUnsupported'));
      setScanning(false);
      return;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => []);
          const raw = found[0]?.rawValue ?? '';
          const m = raw.match(/^FOUNDBACK:(\d{6})$/);
          if (m) {
            setCode(m[1]);
            setScanning(false);
            onComplete(m[1]);
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      })
      .catch(() => {
        setScanError(t('handover.cameraDenied'));
        setScanning(false);
      });
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [scanning, onComplete, t]);

  if (h.role === 'claimant') {
    return (
      <section className="panel stack code-panel" aria-labelledby="code-title">
        <h2 id="code-title">{t('handover.yourCode')}</h2>
        <p className="muted">{t('handover.codeBody')}</p>
        <div className="code-digits" dir="ltr" aria-label={h.code?.split('').join(' ')}>{h.code}</div>
        <canvas ref={canvas} aria-label={t('handover.qrAlt')} />
        <p className="small muted">{t('handover.codeWarning')}</p>
      </section>
    );
  }
  return (
    <section className="panel stack" aria-labelledby="enter-title">
      <h2 id="enter-title">{t('handover.enterCode')}</h2>
      <p className="muted">{t('handover.enterBody')}</p>
      <div className="inline-field">
        <input className="input input--code" inputMode="numeric" maxLength={6} value={code} aria-label={t('handover.codeLabel')} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Button variant="ghost" onClick={() => { setScanError(null); setScanning((s) => !s); }} aria-pressed={scanning}>
          <QrIcon /> {scanning ? t('handover.stopScan') : t('handover.scan')}
        </Button>
      </div>
      {scanning && <video ref={video} className="scanner" muted playsInline />}
      {scanError && <Alert kind="info">{scanError}</Alert>}
      <Button variant="accent" block loading={busy} disabled={code.length !== 6} onClick={() => onComplete(code)}>{t('handover.markReturned')}</Button>
    </section>
  );
}

function PlanSection({ h, busy, onSave }: { h: H; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [places, setPlaces] = useState<SafePlace[] | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [when, setWhen] = useState(h.scheduledFor ? toLocalInput(new Date(h.scheduledFor)) : '');

  useEffect(() => {
    if (h.method !== 'meet' || places) return;
    api<{ places: SafePlace[] }>(`/safe-places?lat=${h.meetingCenter.lat}&lng=${h.meetingCenter.lng}`)
      .then((r) => setPlaces(r.places))
      .catch((err) => setPlacesError(errorMessage(err)));
  }, [h.method, h.meetingCenter.lat, h.meetingCenter.lng, places, errorMessage]);

  return (
    <section className="panel stack" aria-labelledby="plan-title">
      <h2 id="plan-title">{t('handover.planTitle')}</h2>
      <fieldset className="choice-list">
        <legend className="field__label">{t('handover.method')}</legend>
        {(['meet', 'collect', 'courier'] as const).filter((m) => m !== 'collect' || h.itemLocation.current !== 'with_me').map((m) => (
          <label key={m} className="choice">
            <input type="radio" name="method" checked={h.method === m} onChange={() => onSave({ method: m })} disabled={busy} />
            <span>
              <strong>{t(`handover.methods.${m}`)}</strong>
              <span className="option__sub">{t(`handover.methodHelp.${m}`, { where: t(`item.location.${h.itemLocation.current}`) })}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {h.method === 'collect' && h.itemLocation.note && <Alert kind="info"><span dir="auto">{h.itemLocation.note}</span></Alert>}

      {h.method === 'meet' && (
        <div className="stack" style={{ ['--gap' as string]: '10px' }}>
          <h3 style={{ margin: 0 }}>{t('handover.safePlaces')}</h3>
          {placesError ? (
            <Alert kind="info">{placesError}</Alert>
          ) : !places ? (
            <LoadingState />
          ) : places.length === 0 ? (
            <p className="muted small">{t('handover.noPlaces')}</p>
          ) : (
            <>
              <Suspense fallback={<LoadingState />}>
                <PlacesMap center={h.meetingCenter} places={places} selected={h.place?.osmId ?? null} onSelect={(osmId) => {
                  const p = places.find((x) => x.osmId === osmId)!;
                  onSave({ place: { name: p.name, lat: p.lat, lng: p.lng, osmId: p.osmId } });
                }} />
              </Suspense>
              <ul className="option-list" style={{ maxHeight: 260 }}>
                {places.map((p) => (
                  <li key={p.osmId}>
                    <button type="button" className="option" aria-pressed={h.place?.osmId === p.osmId} disabled={busy}
                      onClick={() => onSave({ place: { name: p.name, lat: p.lat, lng: p.lng, osmId: p.osmId } })}>
                      <span className="option__main" dir="auto">
                        {p.name}
                        <span className="option__sub">{t(`handover.placeTypes.${p.type}`)} · {formatDistance(p.distanceM / 1000, user?.units ?? 'km', user?.countryCode)}</span>
                      </span>
                      {h.place?.osmId === p.osmId && <CheckIcon className="option__check" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="when">{t('handover.when')}</label>
        <div className="inline-field">
          <input id="when" className="input" type="datetime-local" min={toLocalInput(new Date())} value={when} onChange={(e) => setWhen(e.target.value)} />
          <Button variant="ghost" disabled={!when || busy} onClick={() => onSave({ scheduledFor: new Date(when).toISOString() })}>{t('app.save')}</Button>
        </div>
        {h.scheduledFor && <span className="field__hint">{t('handover.scheduled', { date: formatDate(h.scheduledFor, user?.countryCode, user?.timezone) })}</span>}
      </div>

      <label className="settings-row" style={{ cursor: 'pointer' }}>
        <span>
          <span className="settings-row__label">{t('handover.shareEmail')}</span>
          <br />
          <span className="settings-row__value">{h.otherSharesEmail ? t('handover.otherShares') : t('handover.otherNotShares')}</span>
        </span>
        <span className="switch">
          <input type="checkbox" checked={h.shareEmail} disabled={busy} onChange={(e) => onSave({ shareEmail: e.target.checked })} />
          <span />
        </span>
      </label>
      {h.emails?.other && (
        <Alert kind="success">
          {t('handover.otherEmail')} <a href={`mailto:${h.emails.other}`} dir="ltr">{h.emails.other}</a>
        </Alert>
      )}
      {h.method === 'courier' && <p className="small muted">{t('handover.courierNote')}</p>}
    </section>
  );
}

function Completed({ h, onRated }: { h: H; onRated: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const [stars, setStars] = useState(5);
  const [note, setNote] = useState('');
  const [share, setShare] = useState(false);
  const [reward, setReward] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/claims/${h.claimId}/rating`, { method: 'POST', body: { stars, note: note.trim() || undefined, shareStory: share, reward: reward ? Number(reward) : undefined } });
      onRated();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-labelledby="done-title">
      <div className="returned-banner">
        <CheckIcon size={28} />
        <div>
          <h2 id="done-title" style={{ margin: 0 }}>{t('handover.returned')}</h2>
          <span className="small">{formatDate(h.completedAt!, user?.countryCode, user?.timezone)}</span>
        </div>
      </div>
      {h.rated ? (
        <p className="muted">{t('handover.thanksRated')}</p>
      ) : (
        <>
          <h3 style={{ margin: 0 }}>{t(h.role === 'claimant' ? 'handover.rateFinder' : 'handover.rateOwner')}</h3>
          <div className="stars" role="radiogroup" aria-label={t('handover.stars')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t('handover.starN', { count: n })} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>★</button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="note">{t('handover.note')}</label>
            <textarea id="note" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
          </div>
          {h.role === 'claimant' && (
            <div className="field">
              <label htmlFor="reward">{t('handover.reward', { currency: user?.currency ?? '' })} ({t('app.optional')})</label>
              <input id="reward" className="input" type="number" min={0} value={reward} onChange={(e) => setReward(e.target.value)} dir="ltr" />
              <span className="field__hint">{t('handover.rewardHint')}</span>
            </div>
          )}
          <label className="choice">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>{t('handover.shareStory')}</span>
          </label>
          {error && <Alert>{error}</Alert>}
          <Button variant="accent" loading={busy} onClick={submit}>{t('handover.sendRating')}</Button>
        </>
      )}
      <Link to="/" className="btn btn--ghost">{t('notFound.home')}</Link>
    </section>
  );
}
