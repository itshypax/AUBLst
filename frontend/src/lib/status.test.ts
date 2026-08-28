import { describe, expect, it } from 'vitest';
import { statusCode, statusDisplay, statusLabel } from './status';

describe('Statusanzeige', () => {
  it('zeigt den internen Status 0 als C an', () => {
    expect(statusDisplay(0)).toBe('C');
    expect(statusDisplay('0')).toBe('C');
    expect(statusDisplay(2)).toBe('2');
  });

  it('ordnet auch ein direkt geliefertes C dem gelben Status 0 zu', () => {
    expect(statusCode('C')).toBe(0);
    expect(statusCode('c')).toBe(0);
    expect(statusCode('unbekannt')).toBeNull();
  });

  it('liefert die Bezeichnungen der Leitstellenanzeige zentral', () => {
    expect(statusLabel('C')).toBe('Alarmiert');
    expect(statusLabel(1)).toBe('Einsatzbereit Funk');
    expect(statusLabel(2)).toBe('Einsatzbereit Wache');
    expect(statusLabel(4)).toBe('An Einsatzstelle');
  });
});
