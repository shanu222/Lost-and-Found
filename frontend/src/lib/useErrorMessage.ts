import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from './api';
import { countryName } from './format';
import { LocationError } from './location';

/** Maps any error to a translated, user-facing sentence. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof LocationError) return t(`location.errors.${err.code}`);
      if (err instanceof ApiError) {
        if (err.code === 'NETWORK') return t('errors.network');
        const d = err.details as { locationCountry?: string; connectionCountry?: string } | undefined;
        if (err.code === 'VPN_DETECTED' && d?.locationCountry && d.connectionCountry) {
          return t('errors.VPN_DETECTED_DETAIL', { location: countryName(d.locationCountry), connection: countryName(d.connectionCountry) });
        }
        return t(`errors.${err.code}`, { defaultValue: t('errors.generic') });
      }
      return t('errors.generic');
    },
    [t],
  );
}
