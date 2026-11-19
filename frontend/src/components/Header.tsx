// App header: brand, desktop nav, country chip (with the "You're seeing items
// in <country>" explainer) and the language switcher — always visible.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { countryName } from '../lib/format';
import { BellIcon, ChatIcon, HomeIcon, LogoMark, SearchIcon, SettingsIcon, TagIcon } from './Icons';
import { useUnread } from '../lib/useUnread';
import { LanguageSwitcher } from './LanguageSwitcher';

/** A staff account that isn't also a regular user (no country): admin area only. */
const isStaffOnly = (u: { role: string; countryCode: string | null } | null) =>
  Boolean(u && (u.role === 'admin' || u.role === 'moderator') && !u.countryCode);

export function Header() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const staffOnly = isStaffOnly(user);
  const unread = useUnread(Boolean(user?.onboarding.completed && user.countryCode));
  const [explain, setExplain] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const country = user?.country;
  const name = country ? countryName(country.code, country.name) : '';

  useEffect(() => {
    if (!explain) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExplain(false);
    const onClick = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-country-chip]')) setExplain(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [explain]);

  return (
    <header className="header">
      <div className="header__inner">
        <Link to="/" className="header__brand">
          <LogoMark />
          <span>{t('app.name')}</span>
        </Link>
        {staffOnly && (
          <nav className="header__nav header__nav--staff" aria-label={t('nav.mainNavigation')}>
            <NavLink to="/admin">{t('nav.admin')}</NavLink>
            <button type="button" className="header__signout" onClick={() => void signOut()}>
              {t('settings.signOut')}
            </button>
          </nav>
        )}
        {!staffOnly && user?.onboarding.completed && (
          <nav className="header__nav" aria-label={t('nav.mainNavigation')}>
            <NavLink to="/" end>
              {t('nav.home')}
            </NavLink>
            <NavLink to="/browse">{t('nav.browse')}</NavLink>
            <NavLink to="/my">{t('nav.my')}</NavLink>
            <NavLink to="/messages">
              {t('nav.messages')}
              {unread.messages > 0 && <span className="dot-count">{unread.messages}</span>}
            </NavLink>
            <NavLink to="/settings">{t('nav.settings')}</NavLink>
            {(user.role === 'admin' || user.role === 'moderator') && <NavLink to="/admin">{t('nav.admin')}</NavLink>}
          </nav>
        )}
        {!staffOnly && user?.onboarding.completed && (
          <NavLink to="/notifications" className="icon-button header__bell" aria-label={t('nav.notificationsCount', { count: unread.notifications })}>
            <BellIcon />
            {unread.notifications > 0 && <span className="dot-count dot-count--float">{unread.notifications > 9 ? '9+' : unread.notifications}</span>}
          </NavLink>
        )}
        {country && (
          <button
            type="button"
            className="chip-button"
            data-country-chip
            aria-expanded={explain}
            aria-controls="country-explainer"
            aria-label={t('header.countryButton', { country: name })}
            onClick={() => setExplain((v) => !v)}
          >
            <span className="flag" aria-hidden="true">
              {country.flag}
            </span>
            <span className="chip-button__label chip-button__label--hide-sm">{name}</span>
          </button>
        )}
        <LanguageSwitcher suggested={country?.languages ?? []} />
      </div>
      {explain && country && (
        <div className="popover" id="country-explainer" ref={popRef} role="region" aria-labelledby="country-explainer-title">
          <h2 id="country-explainer-title">
            <span aria-hidden="true">{country.flag} </span>
            {t('header.countryExplainTitle', { country: name })}
          </h2>
          <p>{t('header.countryExplainBody', { country: name })}</p>
          <p className="small">
            {t('header.countryExplainChange')}{' '}
            <Link to="/settings" onClick={() => setExplain(false)}>
              {t('header.openSettings')}
            </Link>
          </p>
        </div>
      )}
    </header>
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const unread = useUnread(Boolean(user?.onboarding.completed && user.countryCode));
  if (isStaffOnly(user)) return null;
  return (
    <nav className="tabbar" aria-label={t('nav.mainNavigation')}>
      <NavLink to="/" end>
        <HomeIcon />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/browse">
        <SearchIcon />
        {t('nav.browse')}
      </NavLink>
      <NavLink to="/my">
        <TagIcon />
        {t('nav.my')}
      </NavLink>
      <NavLink to="/messages">
        <span className="tab-icon">
          <ChatIcon />
          {unread.messages > 0 && <span className="dot-count dot-count--float">{unread.messages > 9 ? '9+' : unread.messages}</span>}
        </span>
        {t('nav.messages')}
      </NavLink>
      <NavLink to="/settings">
        <SettingsIcon />
        {t('nav.settings')}
      </NavLink>
    </nav>
  );
}
