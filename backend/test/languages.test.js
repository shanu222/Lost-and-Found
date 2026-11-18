// The frontend and backend language lists must stay in sync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/data/languages.js';

const frontendFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/i18n/languages.ts');

describe('supported languages', () => {
  it('English is the first/default language', () => {
    expect(LANGUAGES[0].code).toBe('en');
  });
  it('matches the frontend list', () => {
    if (!fs.existsSync(frontendFile)) return;
    const src = fs.readFileSync(frontendFile, 'utf8');
    const codes = [...src.matchAll(/code: '([a-z]{2,3})'/g)].map((m) => m[1]);
    expect(codes).toEqual(LANGUAGES.map((l) => l.code));
  });
});
