// Maintenance screen and announcement banner, driven by Admin → Settings.
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../lib/appConfig';
import { LogoMark } from './Icons';
import { LanguageSwitcher } from './LanguageSwitcher';

export function MaintenanceScreen() {
  const { t } = useTranslation();
  const { config } = useAppConfig();
  return (
    <main className="full-center maintenance" id="main">
      <div className="stack" style={{ maxWidth: 440, textAlign: 'center', justifyItems: 'center', padding: 24 }}>
        <LogoMark size={56} />
        <h1>{t('system.maintenanceTitle')}</h1>
        <p className="muted" dir="auto">{config.maintenance_message || t('system.maintenanceBody')}</p>
        {config.support_email && <a href={`mailto:${config.support_email}`}>{config.support_email}</a>}
        <LanguageSwitcher suggested={[]} variant="light" />
      </div>
    </main>
  );
}

export function AnnouncementBanner() {
  const { config } = useAppConfig();
  if (!config.announcement) return null;
  return (
    <div className={`announcement announcement--${config.announcement_level}`} role="status" dir="auto">
      {config.announcement}
    </div>
  );
}
