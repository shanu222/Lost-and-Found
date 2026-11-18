// "Report" on every post, claim and message.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useErrorMessage } from '../lib/useErrorMessage';
import { Alert, Button, Dialog } from './ui';

const REASONS = ['scam', 'fake_claim', 'abusive', 'wrong_category', 'other'] as const;

export function ReportButton({ targetType, targetId, compact }: { targetType: 'found_item' | 'lost_report' | 'claim' | 'message' | 'user'; targetId: string; compact?: boolean }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('scam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/reports', { method: 'POST', body: { targetType, targetId, reason, details: details.trim() || undefined } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="link" className={compact ? 'small' : ''} onClick={() => setOpen(true)} style={{ color: 'var(--muted)' }}>
        {t('report.button')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('report.title')} labelledBy={`report-${targetId}`}>
        {done ? (
          <div className="stack">
            <Alert kind="success">{t('report.thanks')}</Alert>
            <Button block onClick={() => setOpen(false)}>{t('app.close')}</Button>
          </div>
        ) : (
          <div className="stack">
            <fieldset className="choice-list">
              <legend className="field__label">{t('report.reason')}</legend>
              {REASONS.map((r) => (
                <label key={r} className="choice">
                  <input type="radio" name={`reason-${targetId}`} checked={reason === r} onChange={() => setReason(r)} />
                  <span>{t(`report.reasons.${r}`)}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor={`report-details-${targetId}`}>{t('report.details')}</label>
              <textarea id={`report-details-${targetId}`} className="input" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
            </div>
            {error && <Alert>{error}</Alert>}
            <Button variant="danger" block loading={busy} onClick={submit}>{t('report.submit')}</Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
