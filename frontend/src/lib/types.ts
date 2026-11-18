export type TrustLevel = 'new' | 'phone_verified' | 'identity_verified' | 'trusted_returner';

export interface CountrySummary {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  dialCodes: string[];
  languages: string[];
}

export interface CountryConfig extends CountrySummary {
  currency: string;
  distanceUnit: 'km' | 'mi';
  timezones: string[];
  defaultTimezone: string;
  emergencyNumber: string;
  authorityName: string;
  nationalIdName: string;
  safePlaceTypes: string[];
  guidance: { ids: string; documents: string; cash: string; general: string };
}

export interface City {
  id: number | null;
  name: string;
  region: string | null;
  lat: number;
  lng: number;
  ref?: string;
}

export interface Me {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: { masked: string; verified: boolean } | null;
  countryCode: string | null;
  country: CountrySummary | null;
  city: City | null;
  home: { lat: number; lng: number; radiusKm: number } | null;
  language: string;
  timezone: string | null;
  currency: string | null;
  units: 'km' | 'mi';
  locale: string | null;
  textDir: 'ltr' | 'rtl';
  role: 'user' | 'moderator' | 'admin';
  trust: { level: TrustLevel; score: number; phoneVerified: boolean; identityVerified: boolean };
  returnsCount: number;
  points: number;
  notificationPrefs: { email: boolean; push: boolean; inapp: boolean };
  onboarding: { completed: boolean; steps: { country: boolean; city: boolean; phone: boolean; profile: boolean } };
  countryChangedAt: string | null;
  nextCountryChangeAt: string | null;
  createdAt: string;
}

export interface SessionResponse {
  accessToken: string;
  user: Me;
}
