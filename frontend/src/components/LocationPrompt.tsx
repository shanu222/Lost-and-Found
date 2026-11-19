// "Share your live location" panel. FoundBack decides the user's country from
// the device's live location. If the device can't share it (blocked, no GPS),
// the internet connection's country is used instead; only if that is unknown
// too does the user choose their country from a list.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthProvider';
import { countryName } from '../lib/format';
import { chooseCountry, NeedsCountryChoice, verifyLocation, type LocationResult } from '../lib/location';
import { useCountries } from '../lib/useCountries';
import { useErrorMessage } from '../lib/useErrorMessage';
import { CountryList } from './CountryList';
import { PinIcon } from './Icons';
import { Alert, Button } from './ui';

export function LocationPrompt({ onVerified, compact, auto }: { onVerified?: (countryCode: string) => void; compact?: boolean; auto?: boolean }) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(user?.location.fresh ? user.location.countryCode : null);
  const [method, setMethod] = useState<LocationResult['method'] | null>(null);
  const [choosing, setChoosing] = useState(false);

  const accept = (r: LocationResult) => {
    setUser(r.user);
    setCountry(r.countryCode);
    setMethod(r.method);
    setChoosing(false);
    onVerified?.(r.countryCode);
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      accept(await verifyLocation());
    } catch (err) {
      if (err instanceof NeedsCountryChoice) setChoosing(true);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // auto: check as soon as the screen opens (the browser asks for permission
  // once; afterwards it is silent).
  const started = useRef(false);
  useEffect(() => {
    if (!auto || started.current || country) return;
    started.current = true;
    void share();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className={`location-prompt ${compact ? 'location-prompt--compact' : ''}`}>
      <span className="location-prompt__icon" aria-hidden="true"><PinIcon size={28} /></span>
      <div className="stack" style={{ ['--gap' as string]: '8px', flex: 1, minWidth: 0 }}>
        {!compact && <strong>{choosing ? t('location.chooseTitle') : t('location.title')}</strong>}
        <p className="small muted" style={{ margin: 0 }}>{choosing ? t('location.chooseBody') : t('location.body')}</p>
        {country && !choosing && (
          <div className="verified" role="status">
            <span aria-hidden="true">✓</span>
            <span>
              {method === 'ip'
                ? t('location.detectedConnection', { country: countryName(country) })
                : method === 'manual'
                  ? t('location.detectedChosen', { country: countryName(country) })
                  : t('location.detected', { country: countryName(country) })}
            </span>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {choosing ? (
          <ChooseCountry onChosen={accept} />
        ) : (
          <Button variant={country ? 'ghost' : 'accent'} onClick={share} loading={busy} loadingText={t('location.checking')}>
            {country ? t('location.again') : t('location.share')}
          </Button>
        )}
        <p className="field__hint" style={{ margin: 0 }}>{t('location.privacy')}</p>
      </div>
    </div>
  );
}

function ChooseCountry({ onChosen }: { onChosen: (r: LocationResult) => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { countries } = useCountries();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      onChosen(await chooseCountry(selected));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ ['--gap' as string]: '10px' }}>
      {countries && <CountryList countries={countries} value={selected} suggested={null} onSelect={setSelected} />}
      {error && <Alert>{error}</Alert>}
      <Button onClick={go} loading={busy} disabled={!selected}>
        {selected ? t('onboarding.country.continueIn', { country: countryName(selected) }) : t('app.continue')}
      </Button>
    </div>
  );
}
