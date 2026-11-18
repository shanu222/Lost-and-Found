// "Translate to <my language>" for user-written text. Original stays visible.
import { useState } from 'react';
import { useAppConfig } from '../lib/appConfig';
import { useTranslation } from 'react-i18next';
import { getLanguage } from '../i18n/languages';
import { api } from '../lib/api';
import { useErrorMessage } from '../lib/useErrorMessage';

function useTranslationEnabled() {
  return useAppConfig().config.translation_available;
}

export function TranslateButton({ type, id, sourceLang }: { type: 'found_item' | 'message' | 'lost_report'; id: string; sourceLang?: string }) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const enabled = useTranslationEnabled();
  const [text, setText] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enabled || sourceLang === i18n.language) return null;
  const lang = getLanguage(i18n.language);

  const toggle = async () => {
    if (shown) return setShown(false);
    if (text) return setShown(true);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ text: string }>('/translate', { method: 'POST', body: { type, id, target: lang.code } });
      setText(r.text);
      setShown(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="translate">
      <button type="button" className="btn btn--link small" onClick={toggle} disabled={busy} aria-expanded={shown}>
        {busy ? t('translate.working') : shown ? t('translate.hide') : t('translate.button', { language: lang.native })}
      </button>
      {shown && text && (
        <p className="translate__text" lang={lang.code} dir={lang.dir}>
          {text}
        </p>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}
