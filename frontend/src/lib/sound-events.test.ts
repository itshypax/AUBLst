import { describe, expect, it } from 'vitest';
import { soundCueForLog, soundCuesForLogs } from './sound-events';
import type { LogRow } from './types';

function row(message: string, longMessage = message): LogRow {
  return {
    id: 1,
    type: 'global',
    entity_id: null,
    event_id: null,
    message,
    long_message: longMessage,
    state: 'active',
    updated_at: '2026-08-11 12:00:00',
  };
}

describe('Soundereignisse', () => {
  it.each([
    ['Alarmstufenerhöhung', 'alarm-level-increase'],
    ['Rettungsmittelknappheit', 'resource-shortage'],
    ['Schiffsverkehr gesperrt', 'ship-blocked'],
    ['Schiffsverkehr freigegeben', 'ship-released'],
    ['Tramverkehr eingestellt', 'tram-blocked'],
    ['Tramverkehr freigegeben', 'tram-released'],
    ['Schienenverkehr eingestellt', 'train-blocked'],
    ['Bahnstrecke gesperrt', 'train-blocked'],
    ['Zugverkehr freigegeben', 'train-released'],
  ] as const)('ordnet „%s“ dem passenden Ton zu', (message, cue) => {
    expect(soundCueForLog(row(message))).toBe(cue);
  });

  it('lässt eine aufgehobene Alarmstufe beim normalen Funkton', () => {
    expect(soundCuesForLogs([row('Alarmstufe aufgehoben')])).toEqual(['radio-message']);
  });

  it('mischt einen vorbereiteten Spezialton nicht mit dem allgemeinen Funkton', () => {
    expect(soundCuesForLogs([row('Tramverkehr eingestellt')])).toEqual(['tram-blocked']);
  });

  it('lässt einen Sprechwunsch wie bisher Vorrang vor normalen Funkmeldungen haben', () => {
    const speech = row('Sprechwunsch', 'Florian Auenburg 1-HLF-1 mit Sprechwunsch');
    expect(soundCuesForLogs([speech, row('S1', 'Fahrzeug meldet Status 1')])).toEqual(['speech-request']);
  });
});
