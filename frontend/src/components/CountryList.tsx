// Searchable list of countries with flags, localised names and native names.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { countryName } from '../lib/format';
import type { CountrySummary } from '../lib/types';
import { CheckIcon } from './Icons';

export function CountryList({
  countries,
  value,
  suggested,
  onSelect,
}: {
  countries: CountrySummary[];
  value: string | null;
  suggested?: string | null;
  onSelect: (code: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    const list = countries.map((c) => ({ ...c, label: countryName(c.code, c.name) }));
    list.sort((a, b) => a.label.localeCompare(b.label, i18n.language));
    return list;
  }, [countries, i18n.language]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((c) => [c.label, c.name, c.nativeName, c.code].some((s) => s?.toLowerCase().includes(q)) || c.dialCodes.some((d) => `+${d}`.startsWith(q)))
    : items;
  const top = !q && suggested ? items.find((c) => c.code === suggested) : undefined;

  const row = (c: (typeof items)[number]) => (
    <li key={c.code}>
      <button type="button" className="option" aria-pressed={value === c.code} onClick={() => onSelect(c.code)}>
        <span className="option__flag" aria-hidden="true">
          {c.flag}
        </span>
        <span className="option__main">
          {c.label}
          {c.nativeName && c.nativeName !== c.label && <span className="option__sub">{c.nativeName}</span>}
        </span>
        {value === c.code && <CheckIcon className="option__check" />}
      </button>
    </li>
  );

  return (
    <div className="stack" style={{ ['--gap' as string]: '12px' }}>
      {top && (
        <div className="stack" style={{ ['--gap' as string]: '6px' }}>
          <span className="small muted">{t('onboarding.country.suggested')}</span>
          <ul className="option-list">{row(top)}</ul>
        </div>
      )}
      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('onboarding.country.search')}
        aria-label={t('onboarding.country.search')}
      />
      {filtered.length ? (
        <ul className="option-list">{filtered.map(row)}</ul>
      ) : (
        <p className="muted small">{t('onboarding.country.noResults', { query })}</p>
      )}
    </div>
  );
}
