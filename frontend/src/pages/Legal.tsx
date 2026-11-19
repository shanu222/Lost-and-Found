// Terms of Use and Privacy Policy. Public pages (signed in or not), in
// English, Urdu and Arabic; other languages fall back to English.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { LogoMark } from '../components/Icons';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAppConfig } from '../lib/appConfig';
import type { LegalDocs } from '../legal/types';

const loaders: Record<string, () => Promise<{ default: LegalDocs }>> = {
  en: () => import('../legal/en'),
  ur: () => import('../legal/ur'),
  ar: () => import('../legal/ar'),
};

export default function Legal({ doc }: { doc: 'terms' | 'privacy' }) {
  const { i18n } = useTranslation();
  const { config } = useAppConfig();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<LegalDocs | null>(null);
  const lang = i18n.language in loaders ? i18n.language : 'en';

  useEffect(() => {
    let alive = true;
    void loaders[lang]().then((m) => alive && setDocs(m.default));
    return () => {
      alive = false;
    };
  }, [lang]);

  useEffect(() => {
    if (docs) document.title = `${docs[doc].title} · FoundBack`;
  }, [docs, doc]);

  const contact = config.support_email || 'returns@foundback.sustainablesolution360.com';
  const d = docs?.[doc];

  return (
    <div className="legal">
      <header className="legal__bar">
        <Link to="/" className="legal__brand">
          <LogoMark />
          <span>FoundBack</span>
        </Link>
        <LanguageSwitcher suggested={[]} />
      </header>
      <main id="main" className="legal__page" lang={lang} dir={lang === 'en' ? 'ltr' : 'rtl'}>
        {d && docs && (
          <article>
            <button type="button" className="legal__back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
              {docs.back}
            </button>
            <h1>{d.title}</h1>
            <p className="legal__updated">{docs.updated}</p>
            <p className="legal__intro">{d.intro}</p>
            {d.sections.map((s) => (
              <section key={s.h}>
                <h2>{s.h}</h2>
                {s.p.map((para) => (
                  <p key={para.slice(0, 40)}>{para}</p>
                ))}
              </section>
            ))}
            <section className="legal__contact">
              <h2>{docs.contactLabel}</h2>
              <p>
                <a href={`mailto:${contact}`} dir="ltr">
                  {contact}
                </a>
              </p>
            </section>
            <nav className="legal__links">
              <Link to="/terms">{docs.terms.title}</Link>
              <Link to="/privacy">{docs.privacy.title}</Link>
            </nav>
          </article>
        )}
      </main>
    </div>
  );
}
