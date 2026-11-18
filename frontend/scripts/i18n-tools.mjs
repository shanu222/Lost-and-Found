// Translation tooling.
//   node scripts/i18n-tools.mjs scaffold   → add every English key (empty) to each language file
//   node scripts/i18n-tools.mjs coverage   → print translation coverage per language
// Empty strings are treated as "missing" by the app and fall back to English.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'src/locales');
const langSrc = fs.readFileSync(path.join(root, 'src/i18n/languages.ts'), 'utf8');
const codes = [...langSrc.matchAll(/code: '([a-z]{2,3})'/g)].map((m) => m[1]);
const PLURAL = /_(zero|one|two|few|many|other)$/;

const read = (code) => {
  const file = path.join(localesDir, `${code}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function fill(source, target) {
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object') out[k] = fill(v, target?.[k] ?? {});
    else out[k] = typeof target?.[k] === 'string' ? target[k] : '';
  }
  // Keep language-specific plural forms (e.g. Arabic _few) that English lacks.
  for (const [k, v] of Object.entries(target ?? {})) if (!(k in out) && PLURAL.test(k)) out[k] = v;
  return out;
}

export function coverage(code) {
  const en = flatten(read('en'));
  const target = flatten(read(code));
  const bases = new Set(Object.keys(en).map((k) => k.replace(PLURAL, '')));
  let done = 0;
  for (const base of bases) {
    const translated = Object.entries(target).some(([k, v]) => k.replace(PLURAL, '') === base && typeof v === 'string' && v.trim());
    if (translated) done += 1;
  }
  return { code, total: bases.size, translated: done, percent: Math.round((done / bases.size) * 100) };
}

const cmd = process.argv[2];
if (cmd === 'scaffold') {
  const en = read('en');
  for (const code of codes.filter((c) => c !== 'en')) {
    fs.writeFileSync(path.join(localesDir, `${code}.json`), `${JSON.stringify(fill(en, read(code)), null, 2)}\n`);
  }
  console.log(`Scaffolded ${codes.length - 1} languages.`);
} else if (cmd === 'coverage') {
  for (const code of codes) {
    const c = coverage(code);
    console.log(`${code.padEnd(4)} ${String(c.percent).padStart(3)}%  (${c.translated}/${c.total})`);
  }
} else {
  console.log('Usage: node scripts/i18n-tools.mjs <scaffold|coverage>');
}
