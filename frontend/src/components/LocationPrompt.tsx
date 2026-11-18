// "Share your live location" panel. FoundBack decides your country from your
// device's GPS (a VPN can't change it), so each person only ever acts in the
// country they are really in.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { countryName } from '../lib/format';
import { verifyLocation } from '../lib/location';
import { useErrorMessage } from '../lib/useErrorMessage';
import { PinIcon } from './Icons';
import { Alert, Button } from './ui';

export function LocationPrompt({ onVerified, compact }: { onVerified?: (countryCode: string) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(user?.location.fresh ? user.location.countryCode : null);

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await verifyLocation();
      setUser(r.user);
      setCountry(r.countryCode);
      onVerified?.(r.countryCode);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`location-prompt ${compact ? 'location-prompt--compact' : ''}`}>
      <span className="location-prompt__icon" aria-hidden="true"><PinIcon size={28} /></span>
      <div className="stack" style={{ ['--gap' as string]: '8px', flex: 1 }}>
        {!compact && <strong>{t('location.title')}</strong>}
        <p className="small muted" style={{ margin: 0 }}>{t('location.body')}</p>
        {country && (
          <div className="verified">
            <span aria-hidden="true">✓</span>
            <span>{t('location.detected', { country: countryName(country) })}</span>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        <Button variant={country ? 'ghost' : 'accent'} onClick={share} loading={busy} loadingText={t('location.checking')}>
          {country ? t('location.again') : t('location.share')}
        </Button>
        <p className="field__hint" style={{ margin: 0 }}>{t('location.privacy')}</p>
      </div>
    </div>
  );
}
