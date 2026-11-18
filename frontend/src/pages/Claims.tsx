// Claim flow screens: the owner's claim form, the finder's side-by-side
// review, and the claim detail with its status timeline.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { CheckIcon, CloseIcon } from '../components/Icons';
import { ItemCard } from '../components/ItemCard';
import { PhotoPicker } from '../components/PhotoPicker';
import { ReportButton } from '../components/ReportButton';
import { Alert, Button, Dialog, ErrorState, LoadingState } from '../components/ui';
import { api, formData } from '../lib/api';
import { proofNeeds } from '../lib/categories';
import { formatDate } from '../lib/format';
import type { Category, ClaimView, CountryConfig, FoundItem, ReviewClaim } from '../lib/types';
import { useApi } from '../lib/useApi';
import { useErrorMessage } from '../lib/useErrorMessage';
import { withLocation } from '../lib/location';

// ---------------------------------------------------------------------------
// Owner: "This is mine — claim it"
// ---------------------------------------------------------------------------
export function ClaimForm() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const item = useApi<{ item: FoundItem }>(`/found-items/${id}`);
  const qs = useApi<{ questions: { id: string; question: string }[]; category: Category }>(`/found-items/${id}/questions`);
  const config = useApi<{ country: CountryConfig }>(user?.countryCode ? `/meta/countries/${user.countryCode}?lang=${i18n.language}` : null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [identifier, setIdentifier] = useState('');
  const [contents, setContents] = useState('');
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [selfie, setSelfie] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadError = item.error || qs.error;
  if (loadError) return <main className="page page--narrow" id="main"><ErrorState message={errorMessage(loadError)} onRetry={() => { item.reload(); qs.reload(); }} /></main>;
  if (!item.data || !qs.data) return <main className="page page--narrow" id="main"><LoadingState /></main>;
  const category = qs.data.category;
  const need = proofNeeds(category);
  const idName = config.data?.country.nationalIdName ?? t('categories.national_id');

  const proofOk =
    (need.identifier !== 'required' || identifier.trim().length >= 3) &&
    (!need.selfie || selfie.length === 1) &&
    (need.identifier !== 'or_images' || identifier.trim().length >= 3 || images.length > 0) &&
    (need.contents !== true || contents.trim().length > 0) &&
    (need.contents !== 'or_images' || contents.trim().length > 0 || images.length > 0);
  const answersOk = qs.data.questions.every((q) => answers[q.id]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = {
        answers: qs.data!.questions.map((q) => ({ questionId: q.id, answer: answers[q.id].trim() })),
        proof: { identifier: identifier.trim() || undefined, contents: contents.trim() || undefined, text: text.trim() || undefined },
      };
      const r = await withLocation(() => api<{ claim: { id: string } }>(`/found-items/${id}/claims`, { method: 'POST', body: formData(data, { proofImages: images, selfie }) }), setUser);
      navigate(`/claims/${r.claim.id}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{t('claim.title')}</h1>
      <ItemCard item={item.data.item} />
      <div className="panel stack" style={{ marginTop: 16 }}>
        <section className="stack">
          <h2>{t('claim.questionsTitle')}</h2>
          <p className="muted small">{t('claim.questionsBody')}</p>
          {qs.data.questions.map((q, i) => (
            <div className="field" key={q.id}>
              <label htmlFor={`ans-${q.id}`} dir="auto">{i + 1}. {q.question}</label>
              <input id={`ans-${q.id}`} className="input" maxLength={300} autoComplete="off" dir="auto" value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
            </div>
          ))}
        </section>

        <section className="stack">
          <h2>{t('claim.proofTitle')}</h2>
          <p className="muted small">{t(`claim.proofHelp.${need.identifier === 'required' && need.selfie ? 'id' : need.identifier === 'or_images' ? 'device' : need.contents === true ? 'contents' : 'other'}`, { idName })}</p>
          {need.identifier !== 'none' && (
            <div className="field">
              <label htmlFor="ident">
                {need.selfie ? t('claim.idNumber', { idName }) : category === 'bank_cards' ? t('claim.cardNumber') : t('claim.serial')}
              </label>
              <input id="ident" className="input" dir="ltr" autoComplete="off" maxLength={64} value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <span className="field__hint">{t('claim.identifierHint')}</span>
            </div>
          )}
          {need.contents !== false && (
            <div className="field">
              <label htmlFor="contents">{t('claim.contents')}</label>
              <textarea id="contents" className="input" rows={3} maxLength={600} value={contents} onChange={(e) => setContents(e.target.value)} dir="auto" />
            </div>
          )}
          {need.selfie && (
            <div className="field">
              <span className="field__label">{t('claim.selfie', { idName })}</span>
              <PhotoPicker files={selfie} onChange={setSelfie} max={1} label={t('claim.selfieAdd')} capture="user" />
            </div>
          )}
          <div className="field">
            <span className="field__label">{t('claim.images')}</span>
            <PhotoPicker files={images} onChange={setImages} label={t('photos.add')} />
          </div>
          <div className="field">
            <label htmlFor="text">{t('claim.text')} ({t('app.optional')})</label>
            <textarea id="text" className="input" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
          </div>
        </section>
        <Alert kind="info">{t('claim.privacy')}</Alert>
        {error && <Alert>{error}</Alert>}
        <Button variant="accent" block loading={busy} disabled={!answersOk || !proofOk} onClick={submit}>{t('claim.submit')}</Button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Finder: review claims side-by-side with the hidden answers
// ---------------------------------------------------------------------------
export function ClaimReview() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ item: FoundItem; claims: ReviewClaim[] }>(`/found-items/${id}/claims`);
  const [dialog, setDialog] = useState<{ claim: ReviewClaim; action: 'approve' | 'reject' | 'ask' } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  if (error) return <main className="page" id="main"><ErrorState message={errorMessage(error)} onRetry={reload} /></main>;
  if (!data) return <main className="page" id="main"><LoadingState /></main>;
  const anyApproved = data.claims.some((c) => c.status === 'approved');

  return (
    <main className="page" id="main">
      <h1>{t('review.title')}</h1>
      <ItemCard item={data.item} />
      {data.claims.length === 0 && <div className="empty"><p>{t('review.empty')}</p></div>}
      <div className="stack" style={{ marginTop: 20, ['--gap' as string]: '20px' }}>
        {data.claims.map((c, n) => (
          <article key={c.id} className="panel stack claim-card" aria-labelledby={`claim-${c.id}`}>
            <header className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2 id={`claim-${c.id}`} style={{ margin: 0 }}>{t('review.claimN', { n: n + 1, name: c.claimant.displayName ?? t('item.someone') })}</h2>
                <span className="small muted">
                  {t(`trust.${c.claimant.trustLevel}`)} · {t('review.memberSince', { date: formatDate(c.claimant.memberSince, user?.countryCode) })} · {t('home.returnsCount', { count: c.claimant.returnsCount })}
                </span>
              </div>
              <span className={`status status--claim-${c.status}`}>{t(`claimStatus.${c.status}`)}</span>
            </header>

            {c.flagged && <Alert>{t('review.flagged')}</Alert>}
            {c.identifierMatch !== null && (
              <div className={`match-banner ${c.identifierMatch ? 'match-banner--ok' : 'match-banner--bad'}`}>
                {c.identifierMatch ? <CheckIcon /> : <CloseIcon />}
                {c.identifierMatch ? t('review.identifierMatch') : t('review.identifierMismatch')}
              </div>
            )}

            <div className="compare" role="table" aria-label={t('review.compare')}>
              <div className="compare__row compare__head" role="row">
                <span role="columnheader">{t('review.question')}</span>
                <span role="columnheader">{t('review.yourAnswer')}</span>
                <span role="columnheader">{t('review.theirAnswer')}</span>
              </div>
              {c.comparison.map((q) => (
                <div className="compare__row" role="row" key={q.questionId}>
                  <span role="cell" dir="auto">{q.question}</span>
                  <span role="cell" dir="auto" className="compare__expected">{q.expected}</span>
                  <span role="cell" dir="auto">{q.answer ?? '—'}</span>
                </div>
              ))}
            </div>

            {c.followUp && (
              <div className="stack" style={{ ['--gap' as string]: '4px' }}>
                <strong>{t('review.followUp')}</strong>
                <span dir="auto">{c.followUp.question}</span>
                <span className="muted" dir="auto">{c.followUp.answer ?? t('review.waitingAnswer')}</span>
              </div>
            )}

            {c.proofs.length > 0 && (
              <div className="stack" style={{ ['--gap' as string]: '8px' }}>
                <strong>{t('review.proof')}</strong>
                {c.proofs.filter((p) => p.text).map((p) => (
                  <p key={p.id} className="proof-text" dir="auto"><span className="small muted">{t(`review.proofKind.${p.kind}`)}: </span>{p.text}</p>
                ))}
                {c.proofs.some((p) => p.kind === 'id_number') && <p className="small muted">{t('review.idProvided')}</p>}
                <div className="photo-grid">
                  {c.proofs.filter((p) => p.thumbUrl).map((p) => (
                    <button key={p.id} type="button" className="photo-thumb" onClick={() => setZoom(p.url ?? p.thumbUrl ?? null)} aria-label={t(`review.proofKind.${p.kind}`)}>
                      <img src={p.thumbUrl} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {['pending', 'follow_up'].includes(c.status) && !anyApproved && (
              <div className="row">
                <Button variant="accent" onClick={() => setDialog({ claim: c, action: 'approve' })}>{t('review.approve')}</Button>
                <Button variant="ghost" onClick={() => setDialog({ claim: c, action: 'ask' })}>{t('review.ask')}</Button>
                <Button variant="ghost" onClick={() => setDialog({ claim: c, action: 'reject' })} style={{ color: 'var(--danger)' }}>{t('review.reject')}</Button>
              </div>
            )}
            <div className="row">
              {c.status === 'approved' && <Link className="btn" to={`/claims/${c.id}/handover`}>{t('my.handover')}</Link>}
              <Link className="btn btn--link" to={`/claims/${c.id}`}>{t('review.openChat')}</Link>
              <ReportButton targetType="claim" targetId={c.id} compact />
            </div>
          </article>
        ))}
      </div>

      {dialog && <DecisionDialog claim={dialog.claim} action={dialog.action} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />}
      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} title={t('review.proof')} labelledBy="zoom-title">
        {zoom && <img src={zoom} alt="" style={{ width: '100%', borderRadius: 12 }} />}
      </Dialog>
    </main>
  );
}

function DecisionDialog({ claim, action, onClose, onDone }: { claim: ReviewClaim; action: 'approve' | 'reject' | 'ask'; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState<'answers_wrong' | 'proof_insufficient' | 'suspicious' | 'other'>('answers_wrong');
  const [note, setNote] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = action === 'approve' ? { action } : action === 'reject' ? { action, reason, note: note.trim() || undefined } : { action, question: question.trim() };
      await api(`/claims/${claim.id}/decision`, { method: 'POST', body });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={t(`review.${action}Title`)} labelledBy="decision-title">
      <div className="stack">
        {action === 'approve' && <p className="muted">{t('review.approveBody')}</p>}
        {action === 'reject' && (
          <>
            <fieldset className="choice-list">
              <legend className="field__label">{t('review.reason')}</legend>
              {(['answers_wrong', 'proof_insufficient', 'suspicious', 'other'] as const).map((r) => (
                <label key={r} className="choice">
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  <span>{t(`review.reasons.${r}`)}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="note">{t('review.note')}</label>
              <textarea id="note" className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}
        {action === 'ask' && (
          <div className="field">
            <label htmlFor="fq">{t('review.followUpQuestion')}</label>
            <textarea id="fq" className="input" rows={2} maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} dir="auto" />
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        <Button variant={action === 'reject' ? 'danger' : 'accent'} block loading={busy} disabled={action === 'ask' && question.trim().length < 3} onClick={submit}>
          {t(`review.${action}`)}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Claim detail + timeline (both parties)
// ---------------------------------------------------------------------------
const ORDER = ['submitted', 'follow_up', 'approved', 'handover_agreed', 'returned'];

export function ClaimDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useApi<{ claim: ClaimView }>(`/claims/${id}`);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (error) return <main className="page page--narrow" id="main"><ErrorState message={errorMessage(error)} onRetry={reload} /></main>;
  if (!data) return <main className="page page--narrow" id="main"><LoadingState /></main>;
  const c = data.claim;
  const done = new Map(c.timeline.map((e) => [e.event, e.at]));
  const steps = c.status === 'rejected' || c.status === 'expired' || c.status === 'withdrawn' ? ['submitted', c.status] : ORDER.filter((e) => e !== 'follow_up' || done.has('follow_up'));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page--narrow" id="main">
      <h1>{c.role === 'claimant' ? t('claimDetail.titleMine') : t('claimDetail.titleFinder')}</h1>
      <ItemCard item={c.item} />
      <div className="panel stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{t('claimDetail.status')}</strong>
          <span className={`status status--claim-${c.status}`}>{t(`claimStatus.${c.status}`)}</span>
        </div>
        <ol className="timeline">
          {steps.map((s) => (
            <li key={s} data-done={done.has(s) || s === c.status}>
              <strong>{t(`timeline.${s}`)}</strong>
              {done.get(s) && <span className="small muted">{formatDate(done.get(s)!, user?.countryCode, user?.timezone)}</span>}
            </li>
          ))}
        </ol>
        {c.status === 'rejected' && c.rejectReason && <Alert kind="info">{t(`review.reasons.${c.rejectReason}`, { defaultValue: t('claimDetail.rejected') })}</Alert>}
        {c.status === 'pending' && c.role === 'claimant' && <p className="small muted">{t('claimDetail.pendingNote', { date: formatDate(c.expiresAt, user?.countryCode) })}</p>}

        {c.followUpQuestion && c.role === 'claimant' && (
          <div className="stack">
            <strong>{t('claimDetail.followUp')}</strong>
            <p dir="auto" style={{ margin: 0 }}>{c.followUpQuestion}</p>
            <textarea className="input" rows={2} maxLength={600} value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label={t('claimDetail.yourAnswer')} dir="auto" />
            <Button loading={busy} disabled={!answer.trim()} onClick={() => act(() => api(`/claims/${c.id}/follow-up`, { method: 'POST', body: { answer } }))}>{t('claimDetail.sendAnswer')}</Button>
          </div>
        )}
        {actionError && <Alert>{actionError}</Alert>}
        <div className="row">
          {c.conversationId && <Link className="btn btn--ghost" to={`/messages/${c.conversationId}`}>{t('claimDetail.chat')}</Link>}
          {c.status === 'approved' && <Link className="btn btn--accent" to={`/claims/${c.id}/handover`}>{t('my.handover')}</Link>}
          {c.role === 'finder' && <Link className="btn btn--link" to={`/my/found/${c.item.id}/claims`}>{t('my.reviewClaims')}</Link>}
          {c.role === 'claimant' && ['pending', 'follow_up'].includes(c.status) && (
            <Button variant="link" loading={busy} onClick={() => act(() => api(`/claims/${c.id}/withdraw`, { method: 'POST' }))}>{t('claimDetail.withdraw')}</Button>
          )}
        </div>
      </div>
    </main>
  );
}
