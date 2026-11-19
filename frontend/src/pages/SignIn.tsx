import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { GoogleButton } from '../components/GoogleButton';
import { Link } from 'react-router-dom';
import { useAppConfig } from '../lib/appConfig';
import { KeyIcon, LogoMark, PinIcon, ShieldIcon } from '../components/Icons';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { EmailPasswordForm } from '../components/EmailPasswordForm';
import { TagIllustration } from '../components/TagIllustration';
import { suggestCountry, useCountries } from '../lib/useCountries';
import type { SessionResponse } from '../lib/types';

export default function SignIn() {
  const { t } = useTranslation();
  const { acceptSession } = useAuth();
  const { config } = useAppConfig();
  const googleEnabled = config.google_signin_available;
  const emailEnabled = config.email_signin_available;
  const { countries } = useCountries();
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    void suggestCountry().then((c) => setSuggested(c ?? 'PK'));
  }, []);
  const suggestedLanguages = countries?.find((c) => c.code === suggested)?.languages ?? [];
  const onSession = useCallback((s: SessionResponse) => acceptSession(s), [acceptSession]);

  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__top">
          <span className="header__brand" style={{ margin: 0 }}>
            <LogoMark />
            {t('app.name')}
          </span>
          <LanguageSwitcher suggested={suggestedLanguages} />
        </div>
        <TagIllustration className="auth__tag" />
        <p className="auth__tagline">{t('app.tagline')}</p>
        <ul className="auth__points">
          <li>
            <ShieldIcon />
            <span>
              <strong>{t('signIn.points.privateTitle')}</strong>
              {t('signIn.points.privateBody')}
            </span>
          </li>
          <li>
            <KeyIcon />
            <span>
              <strong>{t('signIn.points.proofTitle')}</strong>
              {t('signIn.points.proofBody')}
            </span>
          </li>
          <li>
            <PinIcon />
            <span>
              <strong>{t('signIn.points.localTitle')}</strong>
              {t('signIn.points.localBody')}
            </span>
          </li>
        </ul>
      </aside>

      <main className="auth__main" id="main">
        <div className="auth__card stack" style={{ ['--gap' as string]: '20px' }}>
          <div>
            <h1>{t('signIn.title')}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {t('signIn.subtitle')}
            </p>
          </div>
          {googleEnabled && <GoogleButton onSession={onSession} />}
          {googleEnabled && emailEnabled && <div className="divider">{t('signIn.or')}</div>}
          {emailEnabled && <EmailPasswordForm onDone={onSession} />}
          {!googleEnabled && !emailEnabled && <p className="muted">{t('signIn.unavailable')}</p>}
          <p className="small muted" style={{ margin: 0 }}>
            {t('signIn.terms')}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('app.disclaimer')}
          </p>
          {!config.registration_open && <p className="small muted" style={{ margin: 0 }}>{t('system.registrationClosed')}</p>}
          <Link to="/admin/login" className="small muted" style={{ alignSelf: 'flex-start' }}>{t('staff.link')}</Link>
        </div>
      </main>
    </div>
  );
}
