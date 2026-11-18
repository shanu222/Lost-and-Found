// Globe button + dialog. English and the country's languages are offered
// first; any supported language can be picked from the full list.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { LANGUAGES, getLanguage, type LanguageMeta } from '../i18n/languages';
import { useErrorMessage } from '../lib/useErrorMessage';
import { CheckIcon, GlobeIcon } from './Icons';
import { Alert, Dialog } from './ui';

export function LanguageOptions({
  suggested,
  onPicked,
}: {
  suggested: string[];
  onPicked?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { changeLanguage } = useAuth();
  const errorMessage = useErrorMessage();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggestedList = useMemo(
    () => ['en', ...suggested.filter((c) => c !== 'en')].map(getLanguage).filter((l, i, a) => a.indexOf(l) === i),
    [suggested],
  );
  const q = query.trim().toLowerCase();
  const all = LANGUAGES.filter((l) => !q || l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code === q);

  const pick = async (code: string) => {
    setError(null);
    try {
      await changeLanguage(code);
      onPicked?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const item = (l: LanguageMeta) => {
    const current = i18n.language === l.code;
    return (
      <li key={l.code}>
        <button type="button" className="option" aria-pressed={current} onClick={() => pick(l.code)}>
          <span className="option__main">
            <span lang={l.code} dir={l.dir}>
              {l.native}
            </span>
            <span className="option__sub">
              {l.name}
              {!l.complete && ` — ${t('language.partial')}`}
            </span>
          </span>
          {current && <CheckIcon className="option__check" title={t('language.current')} />}
        </button>
      </li>
    );
  };

  return (
    <div className="stack">
      {error && <Alert>{error}</Alert>}
      <section aria-labelledby="lang-suggested" className="stack" style={{ ['--gap' as string]: '8px' }}>
        <h3 id="lang-suggested" className="small muted">
          {t('language.suggested')}
        </h3>
        <ul className="option-list">{suggestedList.map(item)}</ul>
      </section>
      <section aria-labelledby="lang-all" className="stack" style={{ ['--gap' as string]: '8px' }}>
        <h3 id="lang-all" className="small muted">
          {t('language.all')}
        </h3>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('language.search')}
          aria-label={t('language.search')}
        />
        {all.length ? <ul className="option-list">{all.map(item)}</ul> : <p className="muted small">{t('language.noResults', { query })}</p>}
      </section>
    </div>
  );
}

export function LanguageSwitcher({ suggested, variant = 'dark' }: { suggested: string[]; variant?: 'dark' | 'light' }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = getLanguage(i18n.language);
  return (
    <>
      <button
        type="button"
        className="chip-button"
        style={variant === 'light' ? { color: 'var(--harbour-700)', borderColor: 'var(--line)' } : undefined}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t('header.language')}: ${current.native}`}
      >
        <GlobeIcon size={18} />
        <span className="chip-button__label" lang={current.code}>
          {current.native}
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('language.title')} labelledBy="lang-dialog-title">
        <LanguageOptions suggested={suggested} onPicked={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
