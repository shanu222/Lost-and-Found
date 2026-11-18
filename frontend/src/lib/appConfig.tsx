// Live app configuration from Admin → Settings (GET /api/meta/app-config).
// Read by the web app and the installed app at start and every 3 minutes, so
// maintenance mode, announcements, feature switches and limits apply without
// a new release.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface AppConfig {
  maintenance_mode: boolean;
  maintenance_message: string;
  announcement: string;
  announcement_level: 'info' | 'warning';
  support_email: string;
  registration_open: boolean;
  min_app_version: string;
  google_signin_enabled: boolean;
  translation_enabled: boolean;
  push_enabled: boolean;
  travel_mode_enabled: boolean;
  require_live_location: boolean;
  location_max_age_hours: number;
  max_posts_per_day: number;
  max_claims_per_day: number;
  claim_expiry_days: number;
  travel_days: number;
  country_change_cooldown_days: number;
  google_client_id: string;
  vapid_public_key: string;
  translation_available: boolean;
  google_signin_available: boolean;
  email_signin_available: boolean;
  push_available: boolean;
}

const DEFAULTS: AppConfig = {
  maintenance_mode: false, maintenance_message: '', announcement: '', announcement_level: 'info', support_email: '',
  registration_open: true, min_app_version: '1.0.0', google_signin_enabled: true, translation_enabled: true, push_enabled: true,
  travel_mode_enabled: true, require_live_location: true, location_max_age_hours: 24, max_posts_per_day: 10, max_claims_per_day: 3,
  claim_expiry_days: 7, travel_days: 30, country_change_cooldown_days: 30, google_client_id: '', vapid_public_key: '',
  translation_available: false, google_signin_available: false, email_signin_available: true, push_available: false,
};

const Ctx = createContext<{ config: AppConfig; loaded: boolean; reload: () => void }>({ config: DEFAULTS, loaded: false, reload: () => {} });

let current: AppConfig = DEFAULTS;
export const getAppConfig = () => current;

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const reload = () => {
    api<{ config: AppConfig }>('/meta/app-config')
      .then((r) => {
        current = { ...DEFAULTS, ...r.config };
        setConfig(current);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  };
  useEffect(() => {
    reload();
    const id = setInterval(reload, 3 * 60_000);
    window.addEventListener('fb:maintenance', reload);
    return () => {
      clearInterval(id);
      window.removeEventListener('fb:maintenance', reload);
    };
  }, []);
  return <Ctx.Provider value={{ config, loaded, reload }}>{children}</Ctx.Provider>;
}

export const useAppConfig = () => useContext(Ctx);
