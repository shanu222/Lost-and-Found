// Builds the default configuration for every ISO 3166 country from open
// datasets (countries-list, countries-and-timezones) plus hand-written
// overrides. These are DEFAULTS only: on start-up missing countries are
// inserted, existing rows (which admins may have edited) are never touched.
import { countries as COUNTRY_DATA, getEmojiFlag } from 'countries-list';
import ct from 'countries-and-timezones';
import { LANGUAGE_CODES } from './languages.js';

const MILES = new Set(['US', 'GB', 'LR', 'MM']);

// Languages offered next to English when the dataset's first pick isn't ideal.
const LANGUAGE_OVERRIDES = {
  PK: ['ur'], IN: ['hi'], AE: ['ar'], SA: ['ar'], QA: ['ar'], KW: ['ar'], BH: ['ar'], OM: ['ar'],
  EG: ['ar'], JO: ['ar'], MA: ['ar', 'fr'], DZ: ['ar', 'fr'], TN: ['ar', 'fr'], ES: ['es'], FR: ['fr'],
  TR: ['tr'], BD: ['bn'], ID: ['id'], CN: ['zh'], TW: ['zh'], HK: ['zh'], IR: ['fa'],
  IL: ['he', 'ar'], AF: ['ps', 'fa'], MY: ['ms'], PH: ['fil'], CA: ['fr'], BE: ['nl', 'fr', 'de'],
  CH: ['de', 'fr', 'it'], KE: ['sw'], TZ: ['sw'],
};

const TIMEZONE_OVERRIDES = {
  US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', BR: 'America/Sao_Paulo',
  RU: 'Europe/Moscow', MX: 'America/Mexico_City', ID: 'Asia/Jakarta', KZ: 'Asia/Almaty',
  CN: 'Asia/Shanghai', AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago',
  NZ: 'Pacific/Auckland', PT: 'Europe/Lisbon', ES: 'Europe/Madrid', EC: 'America/Guayaquil',
  DE: 'Europe/Berlin', MN: 'Asia/Ulaanbaatar', CD: 'Africa/Kinshasa', UA: 'Europe/Kyiv',
  MY: 'Asia/Kuala_Lumpur', FR: 'Europe/Paris', GB: 'Europe/London', NL: 'Europe/Amsterdam',
};

const EMERGENCY = {
  US: '911', CA: '911', MX: '911', PH: '911', SA: '911', GB: '999', IE: '112', AE: '999', QA: '999',
  BH: '999', BD: '999', MY: '999', SG: '999', HK: '999', KE: '999', OM: '9999', PK: '15',
  AU: '000', NZ: '111', CN: '110', JP: '110', ID: '110', KR: '112', EG: '122', ZA: '10111', BR: '190',
  IN: '112', TR: '112', KW: '112', NG: '112',
};

// Generic guidance used for every country without its own text.
const GENERIC_GUIDANCE = {
  en: {
    ids: 'Found an ID card or passport? The safest option is to hand it to the nearest police station or the office that issued it, then post it here so the owner knows where to collect it.',
    documents: 'Keep documents private. Never post photos of them publicly — FoundBack shows an illustration instead.',
    cash: 'For cash, consider handing it to the police and post it here with a hidden question about the exact amount.',
    general: 'FoundBack connects people. Meet only in safe public places and never share personal details before a claim is approved.',
  },
};

// Country-specific configuration for the launch countries.
const COUNTRY_OVERRIDES = {
  PK: {
    authority_name: 'Police (15) / NADRA',
    national_id_name: 'CNIC',
    id_mask_pattern: '\\b\\d{5}[- ]?\\d{7}[- ]?\\d\\b',
    safe_place_types: ['police', 'bank', 'mall', 'station'],
    guidance: {
      en: {
        ids: 'Found a CNIC? Hand it to the nearest police station or a NADRA office, then post it here so the owner can find it.',
        documents: 'Do not share photos of documents publicly. Hand vehicle documents to the nearest police station or Excise office.',
        cash: 'For cash, hand it to the nearest police station (dial 15) and add a hidden question about the exact amount.',
        general: GENERIC_GUIDANCE.en.general,
      },
      ur: {
        ids: 'شناختی کارڈ (CNIC) ملا ہے؟ اسے قریبی پولیس اسٹیشن یا نادرا دفتر میں جمع کروائیں، پھر یہاں پوسٹ کریں تاکہ مالک اسے تلاش کر سکے۔',
        documents: 'دستاویزات کی تصاویر عوامی طور پر شیئر نہ کریں۔ گاڑی کے کاغذات قریبی پولیس اسٹیشن یا ایکسائز دفتر میں جمع کروائیں۔',
        cash: 'نقد رقم قریبی پولیس اسٹیشن (15) میں جمع کروائیں اور درست رقم کے بارے میں ایک خفیہ سوال شامل کریں۔',
        general: 'FoundBack لوگوں کو آپس میں ملاتا ہے۔ صرف محفوظ عوامی مقامات پر ملیں اور دعویٰ منظور ہونے سے پہلے ذاتی معلومات شیئر نہ کریں۔',
      },
    },
  },
  AE: {
    authority_name: 'Police (999)',
    national_id_name: 'Emirates ID',
    id_mask_pattern: '\\b784[- ]?\\d{4}[- ]?\\d{7}[- ]?\\d\\b',
    safe_place_types: ['police', 'mall', 'station', 'bank'],
    guidance: {
      en: {
        ids: 'Found an Emirates ID or passport? Hand it to the nearest police station, then post it here.',
        documents: 'Do not share photos of documents publicly. Hand official documents to the nearest police station.',
        cash: 'Found cash must be handed to the police in the UAE. Post it here with the police station name.',
        general: GENERIC_GUIDANCE.en.general,
      },
      ar: {
        ids: 'هل وجدت بطاقة هوية إماراتية أو جواز سفر؟ سلّمها إلى أقرب مركز شرطة، ثم انشرها هنا.',
        documents: 'لا تشارك صور المستندات علنًا. سلّم المستندات الرسمية إلى أقرب مركز شرطة.',
        cash: 'يجب تسليم الأموال التي يُعثر عليها إلى الشرطة في الإمارات. انشرها هنا مع اسم مركز الشرطة.',
        general: 'يربط FoundBack بين الناس. التقِ فقط في أماكن عامة آمنة ولا تشارك بياناتك الشخصية قبل الموافقة على المطالبة.',
      },
    },
  },
  GB: {
    authority_name: 'Police (101 non-emergency)',
    national_id_name: 'Passport / Driving licence',
    id_mask_pattern: '\\b[A-CEGHJ-PR-TW-Z]{2}\\s?\\d{2}\\s?\\d{2}\\s?\\d{2}\\s?[A-D]\\b',
    safe_place_types: ['police', 'station', 'mall', 'bank'],
    guidance: {
      en: {
        ids: 'Found a passport? Return it to HM Passport Office or hand it to a police station. Driving licences can be posted to the DVLA.',
        documents: 'Never post photos of documents publicly — FoundBack shows an illustration instead.',
        cash: 'For large sums of cash, report it to the police on 101 and add a hidden question about the exact amount.',
        general: GENERIC_GUIDANCE.en.general,
      },
    },
  },
  US: {
    authority_name: 'Local police (non-emergency line)',
    national_id_name: "Driver's license / Passport",
    id_mask_pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
    safe_place_types: ['police', 'mall', 'bank', 'station'],
    guidance: {
      en: {
        ids: "Found a driver's license or passport? Hand it to the local police department or drop a passport at any post office that accepts passport applications.",
        documents: 'Never post photos of documents publicly — FoundBack shows an illustration instead.',
        cash: 'For cash, consider turning it in to the local police department and add a hidden question about the exact amount.',
        general: GENERIC_GUIDANCE.en.general,
      },
    },
  },
  IN: {
    national_id_name: 'Aadhaar / Passport',
    id_mask_pattern: '\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b',
  },
  SA: { national_id_name: 'National ID / Iqama', id_mask_pattern: '\\b[12]\\d{9}\\b' },
};

/** Pick a sensible default time zone for a country. */
function defaultTimezone(code, capital, zones) {
  if (TIMEZONE_OVERRIDES[code]) return TIMEZONE_OVERRIDES[code];
  if (zones.length <= 1) return zones[0] ?? 'UTC';
  const cap = (capital || '').replace(/ /g, '_');
  return zones.find((z) => cap && z.endsWith(`/${cap}`)) ?? zones[0];
}

function suggestedLanguages(code, datasetLanguages) {
  if (LANGUAGE_OVERRIDES[code]) return LANGUAGE_OVERRIDES[code];
  return datasetLanguages.filter((l) => l !== 'en' && LANGUAGE_CODES.has(l)).slice(0, 3);
}

/** Default config for every ISO country, as rows ready for INSERT. */
export function buildCountryDefaults() {
  return Object.entries(COUNTRY_DATA).map(([code, c]) => {
    const tz = ct.getCountry(code)?.timezones ?? [];
    const o = COUNTRY_OVERRIDES[code] ?? {};
    return {
      code,
      name: c.name,
      native_name: c.native,
      flag: getEmojiFlag(code),
      dial_codes: (c.phone ?? []).map(String),
      currency: (c.currency ?? [])[0] ?? null,
      distance_unit: MILES.has(code) ? 'mi' : 'km',
      timezones: tz,
      default_timezone: defaultTimezone(code, c.capital, tz),
      emergency_number: EMERGENCY[code] ?? '112',
      authority_name: o.authority_name ?? 'the local police',
      national_id_name: o.national_id_name ?? 'National ID/Passport',
      id_mask_pattern: o.id_mask_pattern ?? null,
      guidance: o.guidance ?? GENERIC_GUIDANCE,
      safe_place_types: o.safe_place_types ?? ['police', 'bank', 'mall', 'station'],
      languages: suggestedLanguages(code, c.languages ?? []),
    };
  });
}

export { GENERIC_GUIDANCE };
