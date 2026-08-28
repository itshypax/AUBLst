import { describe, expect, it } from 'vitest';
import { normalizeSessionToken } from './session-token';

describe('Sitzungscode', () => {
  it('normalisiert eingegebene Hex-Codes auf Kleinbuchstaben', () => {
    expect(normalizeSessionToken(' FE79 ')).toBe('fe79');
  });

  it('lässt einen fehlenden Code leer', () => {
    expect(normalizeSessionToken(null)).toBe('');
  });
});
