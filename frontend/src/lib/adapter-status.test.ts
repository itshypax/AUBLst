import { describe, expect, it } from 'vitest';
import { adapterIndicator } from './adapter-status';
import { adapterView } from './polling';

describe('adapterIndicator', () => {
  const now = new Date('2026-11-14T12:00:20+01:00').getTime();
  const view = (game: boolean, round: boolean, ageSeconds: number) =>
    adapterView({ game, round, version: '1.5.0', age: ageSeconds }, now);

  it('zeigt nichts, solange der Adapter nichts meldet', () => {
    expect(adapterIndicator(null, now)).toBeNull();
  });

  it('nennt den dringendsten Zustand', () => {
    expect(adapterIndicator(view(true, true, 3), now)).toMatchObject({ kind: 'ok', text: 'Spiel läuft' });
    expect(adapterIndicator(view(true, false, 3), now)).toMatchObject({ kind: 'warn', text: 'Wartet auf Rundenstart' });
    expect(adapterIndicator(view(false, false, 3), now)?.title).toBe('Adapter 1.5.0, zuletzt gemeldet vor 3 s');
  });

  it('gilt nach 15 Sekunden ohne Meldung als offline, auch wenn der Browser nichts Neues holt', () => {
    const seen = view(true, true, 5);
    expect(adapterIndicator(seen, now + 9_000)?.kind).toBe('ok');
    const offline = adapterIndicator(seen, now + 11_000);
    expect(offline?.kind).toBe('error');
    expect(offline?.text).toMatch(/^Adapter offline seit \d\d:\d\d$/);
  });
});
