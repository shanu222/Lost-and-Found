// i18next setup.
// * English is the default and the fallback for every missing key.
// * The language NEVER changes on its own: it's whatever the user picked
//   (saved on the profile, or in localStorage before sign-in).
// * Non-English bundles are lazy-loaded; switching is instant, no reload.
// * <html lang dir> follow the language, so RTL layout is automatic.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import { DEFAULT_LANGUAGE, getLanguage, isSupported } from './languages';

const STORAGE_KEY = 'fb_lang';
const loaders = import.meta.glob<{ default: Record<string, unknown> }>(['../locales/*.json', '!../locales/en.json']);

export function storedLanguage(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isSupported(v) ? (v as string) : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function applyDocumentLanguage(code: string) {
  const meta = getLanguage(code);
  document.documentElement.lang = meta.code;
  document.documentElement.dir = meta.dir;
}

async function ensureLoaded(code: string) {
  if (code === 'en' || i18n.hasResourceBundle(code, 'translation')) return;
  const loader = loaders[`../locales/${code}.json`];
  if (!loader) return;
  const mod = await loader();
  i18n.addResourceBundle(code, 'translation', mod.default, true, true);
}

/** Switch language instantly and remember it on this device. */
export async function setLanguage(code: string) {
  const lang = isSupported(code) ? code : DEFAULT_LANGUAGE;
  await ensureLoaded(lang);
  await i18n.changeLanguage(lang);
  applyDocumentLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode — ignore */
  }
}

export async function initI18n(initial = storedLanguage()) {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: false,
    returnEmptyString: false, // scaffolded "" keys fall back to English
    interpolation: { escapeValue: false }, // React already escapes
    react: { useSuspense: false },
  });
  await setLanguage(initial);
  return i18n;
}

export default i18n;
