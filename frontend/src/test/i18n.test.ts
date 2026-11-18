// Language behaviour: English default + fallback, RTL direction, complete
// translations for the shipped languages.
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ur from '../locales/ur.json';
import ar from '../locales/ar.json';
import i18n, { initI18n, setLanguage } from '../i18n';
import { LANGUAGES } from '../i18n/languages';

type Tree = { [k: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;
function keys(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}
const bases = (obj: Tree) => new Set(keys(obj).map((k) => k.replace(PLURAL, '')));

beforeAll(async () => {
  localStorage.clear();
  await initI18n();
});

describe('i18n', () => {
  it('defaults to English and never picks a language on its own', () => {
    expect(i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches to Urdu instantly with RTL and remembers the choice', async () => {
    await setLanguage('ur');
    expect(i18n.t('nav.home')).toBe('ہوم');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('fb_lang')).toBe('ur');
  });

  it('uses Arabic plural rules', async () => {
    await setLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(i18n.t('home.returnsCount', { count: 2 })).toBe('أعدت غرضين');
    expect(i18n.t('home.returnsCount', { count: 5 })).toBe('أعدت 5 أغراض');
  });

  it('falls back to English for keys missing in a scaffolded language', async () => {
    await setLanguage('es');
    expect(i18n.t('nav.settings')).toBe('Settings');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to English for an unsupported language code', async () => {
    await setLanguage('xx');
    expect(i18n.language).toBe('en');
  });

  it('ships every English string in Urdu and Arabic', () => {
    const want = bases(en as unknown as Tree);
    for (const [name, file] of [['ur', ur], ['ar', ar]] as const) {
      const flat = keys(file as unknown as Tree);
      const have = new Set(flat.filter((k) => {
        const v = k.split('.').reduce<unknown>((o, p) => (o as Tree)[p], file);
        return typeof v === 'string' && v.trim();
      }).map((k) => k.replace(PLURAL, '')));
      const missing = [...want].filter((k) => !have.has(k));
      expect(missing, `${name} is missing keys`).toEqual([]);
    }
  });

  it('marks Urdu, Arabic, Persian, Hebrew and Pashto as RTL', () => {
    const rtl = LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code).sort();
    expect(rtl).toEqual(['ar', 'fa', 'he', 'ps', 'ur']);
  });
});
