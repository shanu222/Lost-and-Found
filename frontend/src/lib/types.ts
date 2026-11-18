export type TrustLevel = 'new' | 'email_verified' | 'identity_verified' | 'trusted_returner';

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
  emailVerified: boolean;
  signInMethods: { email: boolean; google: boolean };
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
  trust: { level: TrustLevel; score: number; emailVerified: boolean; identityVerified: boolean };
  returnsCount: number;
  points: number;
  notificationPrefs: { email: boolean; push: boolean; inapp: boolean };
  onboarding: { completed: boolean; steps: { country: boolean; city: boolean; profile: boolean } };
  travel: { countryCode: string; until: string } | null;
  location: { countryCode: string | null; verifiedAt: string | null; fresh: boolean; required: boolean };
  hasPassword: boolean;
  countryChangedAt: string | null;
  nextCountryChangeAt: string | null;
  createdAt: string;
}

export interface SessionResponse {
  accessToken: string;
  user: Me;
}

export type Category =
  | 'phone' | 'wallet' | 'national_id' | 'bank_cards' | 'documents' | 'keys' | 'bag' | 'jewellery'
  | 'watch' | 'laptop' | 'vehicle_documents' | 'pets' | 'childrens_items' | 'cash' | 'other';

export interface Photo {
  id: string;
  thumbUrl: string;
  url?: string;
  isPublic?: boolean;
  moderation?: string;
}

export interface FoundItem {
  id: string;
  countryCode: string;
  category: Category;
  description: string;
  descriptionLang: string;
  area: { lat: number; lng: number; radiusM: number; label: string | null; city: string | null };
  foundAt: string;
  status: 'waiting' | 'under_review' | 'returned' | 'closed' | 'removed';
  currentLocation: 'with_me' | 'police' | 'shop_office';
  currentLocationNote: string | null;
  noReward: boolean;
  illustration: boolean;
  photos: Photo[];
  distanceM: number | null;
  isMine: boolean;
  createdAt: string;
  exact?: { lat: number; lng: number };
  rawStatus?: string;
  claimCount?: number;
  pendingClaimCount?: number;
  matchCount?: number;
  approvedClaimId?: string | null;
  myClaim?: { id: string; status: ClaimStatus } | null;
  canClaim?: boolean;
  finder?: { displayName: string | null; returnsCount: number };
}

export interface LostReport {
  id: string;
  countryCode: string;
  category: Category;
  description: string;
  location: { lat: number; lng: number; radiusM: number };
  lostFrom: string;
  lostTo: string;
  reward: { amount: number; currency: string } | null;
  isTravel: boolean;
  travelUntil: string | null;
  status: 'open' | 'found' | 'closed' | 'expired';
  photos: Photo[];
  createdAt: string;
  matches?: { score: number; matchedAt: string; item: FoundItem }[];
}

export type ClaimStatus = 'pending' | 'follow_up' | 'approved' | 'rejected' | 'expired' | 'withdrawn';

export interface ClaimView {
  id: string;
  role: 'finder' | 'claimant';
  status: ClaimStatus;
  rejectReason: string | null;
  followUpQuestion: string | null;
  createdAt: string;
  expiresAt: string;
  item: FoundItem;
  conversationId: string | null;
  handover: { id: string; completed: boolean } | null;
  timeline: { event: string; at: string }[];
}

export interface ReviewClaim {
  id: string;
  status: ClaimStatus;
  createdAt: string;
  expiresAt: string;
  rejectReason: string | null;
  followUp: { question: string; answer: string | null } | null;
  identifierMatch: boolean | null;
  flagged: boolean;
  flags?: string[];
  claimant: { displayName: string | null; memberSince: string; returnsCount: number; trustLevel: TrustLevel };
  comparison: { questionId: string; question: string; expected: string; answer: string | null }[];
  proofs: { id: string; kind: string; text?: string; provided?: boolean; url?: string; thumbUrl?: string }[];
}

export interface Handover {
  id: string;
  claimId: string;
  role: 'finder' | 'claimant';
  category: Category;
  finderAgreed: boolean;
  ownerAgreed: boolean;
  bothAgreed: boolean;
  method: 'meet' | 'courier' | 'collect' | null;
  place: { name: string; lat: number; lng: number; osmId?: string } | null;
  scheduledFor: string | null;
  shareEmail: boolean;
  otherSharesEmail: boolean;
  emails: { other: string | null } | null;
  code: string | null;
  completedAt: string | null;
  itemLocation: { current: string; note: string | null; approx: { lat: number; lng: number } };
  rated: boolean;
  meetingCenter: { lat: number; lng: number };
}

export interface SafePlace {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  type: 'police' | 'bank' | 'mall' | 'station';
  distanceM: number;
}

export interface ConversationSummary {
  id: string;
  claimId: string;
  itemId: string;
  role: 'finder' | 'claimant';
  otherName: string | null;
  category: Category;
  description: string;
  claimStatus: ClaimStatus;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
}

export interface Message {
  id: string;
  mine: boolean;
  body: string;
  language: string;
  masked: boolean;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  data: Record<string, string | number> & { url?: string; category?: Category };
  read: boolean;
  createdAt: string;
}

export interface SavedAlert {
  id: string;
  category: Category | null;
  keywords: string | null;
  label: string | null;
  location: { lat: number; lng: number; radiusM: number };
  activeUntil: string;
}

export interface Story {
  id: string;
  note: string;
  stars: number;
  category: Category;
  city: string | null;
  days: number;
}
