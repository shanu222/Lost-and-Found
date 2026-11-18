import { describe, expect, it } from 'vitest';
import { blindIndex, decrypt, encrypt } from '../src/lib/crypto.js';
import { approximate, haversine } from '../src/lib/geo.js';
import { normalizePhone } from '../src/lib/phone.js';

describe('field encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('35-201-1234567-1');
    const b = encrypt('35-201-1234567-1');
    expect(a).not.toEqual(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(decrypt(a)).toBe('35-201-1234567-1');
  });

  it('detects tampering', () => {
    const parts = encrypt('secret').split(':');
    parts[3] = Buffer.from('XXXXXX').toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('blind index ignores spacing/case and differs by purpose', () => {
    expect(blindIndex('ab 12-34')).toBe(blindIndex('AB1234'));
    expect(blindIndex('x', 'phone')).not.toBe(blindIndex('x', 'id'));
  });
});

describe('phone numbers', () => {
  it('normalises national input with the country', () => {
    expect(normalizePhone('0300 1234567', 'PK').e164).toBe('+923001234567');
  });
  it('rejects numbers from another country', () => {
    expect(() => normalizePhone('+971501234567', 'PK')).toThrow(/must belong/);
  });
  it('rejects invalid numbers', () => {
    expect(() => normalizePhone('12345', 'PK')).toThrow();
  });
});

describe('approximate location', () => {
  it('keeps the real point inside the public 500 m circle', () => {
    for (let i = 0; i < 200; i++) {
      const p = approximate(33.6844, 73.0479, 500);
      expect(haversine(33.6844, 73.0479, p.lat, p.lng)).toBeLessThanOrEqual(301);
    }
  });
});
