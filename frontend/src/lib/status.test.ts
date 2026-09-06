import { describe, expect, it } from 'vitest';
import { statusClass, statusCode, statusDisplay, statusLabel } from './status';

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

describe('Spielstatus plus Buchstabe', () => {
  it('hängt C an den Spielstatus, wenn das Fahrzeug alarmiert ist', () => {
    expect(statusDisplay(0, { gameStatus: 2 })).toBe('2C');
    expect(statusDisplay('C', { gameStatus: 1 })).toBe('1C');
    expect(statusDisplay(0, { gameStatus: 0 })).toBe('C');
    expect(statusDisplay(0, { gameStatus: null })).toBe('C');
    expect(statusDisplay(0, { gameStatus: 2, called: true })).toBe('2C');
  });

  it('hängt J an den Status bei einer Sprechaufforderung', () => {
    expect(statusDisplay(3, { called: true })).toBe('3J');
    expect(statusDisplay(3, { called: false })).toBe('3');
    expect(statusLabel(3, { called: true })).toBe('Sprechaufforderung');
    expect(statusLabel(3)).toBe('Einsatz übernommen');
    expect(statusLabel(0, { called: true })).toBe('Alarmiert');
  });

  it('liefert die Farbklasse für Badge und Kachel', () => {
    expect(statusClass(3, true)).toBe('status-called');
    expect(statusClass(3)).toBe('status-3');
    expect(statusClass('C')).toBe('status-0');
    expect(statusClass(0, true)).toBe('status-0');
    expect(statusClass('x')).toBe('status-unknown');
  });
});
