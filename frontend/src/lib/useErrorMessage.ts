import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from './api';
import { LocationError } from './location';

/** Maps any error to a translated, user-facing sentence. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof LocationError) return t(`location.errors.${err.code}`);
      if (err instanceof ApiError) {
        if (err.code === 'NETWORK') return t('errors.network');
        return t(`errors.${err.code}`, { defaultValue: t('errors.generic') });
      }
      return t('errors.generic');
    },
    [t],
  );
}
