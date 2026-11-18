// UI languages FoundBack supports. Keep in sync with
// frontend/src/i18n/languages.ts (a test checks the codes match).
// `complete` languages ship full translations; the rest are scaffolded for
// translators and fall back to English for missing keys.
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', complete: true },
  { code: 'ur', name: 'Urdu', native: 'اردو', dir: 'rtl', complete: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl', complete: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', dir: 'rtl' },
  { code: 'he', name: 'Hebrew', native: 'עברית', dir: 'rtl' },
  { code: 'ps', name: 'Pashto', native: 'پښتو', dir: 'rtl' },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr' },
  { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr' },
  { code: 'it', name: 'Italian', native: 'Italiano', dir: 'ltr' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', dir: 'ltr' },
  { code: 'ru', name: 'Russian', native: 'Русский', dir: 'ltr' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', dir: 'ltr' },
  { code: 'pl', name: 'Polish', native: 'Polski', dir: 'ltr' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', dir: 'ltr' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', dir: 'ltr' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', dir: 'ltr' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', dir: 'ltr' },
  { code: 'fil', name: 'Filipino', native: 'Filipino', dir: 'ltr' },
  { code: 'th', name: 'Thai', native: 'ไทย', dir: 'ltr' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', native: '中文', dir: 'ltr' },
  { code: 'ja', name: 'Japanese', native: '日本語', dir: 'ltr' },
  { code: 'ko', name: 'Korean', native: '한국어', dir: 'ltr' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', dir: 'ltr' },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));
export const RTL_LANGUAGES = new Set(LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code));
export const isSupportedLanguage = (code) => LANGUAGE_CODES.has(code);
export const textDirFor = (code) => (RTL_LANGUAGES.has(code) ? 'rtl' : 'ltr');
