import { describe, expect, it } from 'vitest';
import type { Assignment, EventItem, LogRow, Vehicle } from './types';
import { buildSpeechRequestEntries, isSpeechRequest, speechRequestVehicle } from './speech-requests';

const vehicles: Vehicle[] = [
  { id: 1, game_vehicle_id: '4_RTW_B', name: '4-RTW-B', type: 'RTW', modes: null, x: 0, y: 0, status: 5, assigned_player_id: null },
  { id: 2, game_vehicle_id: '74_RTW_B', name: '74-RTW-B', type: 'RTW', modes: null, x: 0, y: 0, status: 5, assigned_player_id: null },
];

function log(id: number, entity: string, message = 'Sprechwunsch'): LogRow {
  return {
    id,
    type: 'vehicle',
    entity_id: entity,
    event_id: null,
    message,
    long_message: `Rettung Auenburg ${entity.replaceAll('_', '-')} mit Sprechwunsch`,
    state: 'active',
    created_at: `2026-08-10 10:0${id}:00`,
    updated_at: `2026-08-10 10:0${id}:00`,
  };
}

describe('Sprechwunsch-Warteschlange', () => {
  it('erkennt Status-5-Varianten als Sprechwunsch', () => {
    expect(isSpeechRequest(log(1, '4_RTW_B', 'FMS5'))).toBe(true);
    expect(isSpeechRequest({ ...log(2, '4_RTW_B'), message: 'S1', long_message: 'Fahrzeug einsatzbereit' })).toBe(false);
  });

  it('verwechselt 4-RTW-B nicht mit 74-RTW-B', () => {
    const row = { ...log(1, ''), long_message: 'Rettung Auenburg 74-RTW-B mit Sprechwunsch' };
    expect(speechRequestVehicle(row, vehicles)?.id).toBe(2);
  });

  it('verwendet einen Anzeigenamen nicht als technische Fahrzeugkennung', () => {
    const police = { ...vehicles[0], id: 3, game_vehicle_id: 'FuSTW', name: 'Streifenwagen' };
    const row = { ...log(1, 'Streifenwagen'), long_message: 'Streifenwagen mit Sprechwunsch' };
    expect(speechRequestVehicle(row, [...vehicles, police])).toBeUndefined();
  });

  it('führt doppelte Meldungen eines Fahrzeugs zu einem offenen Eintrag zusammen', () => {
    const event: EventItem = { id: 1030, game_event_id: '30', name: 'Verkehrsunfall', x: 0, y: 0, status: 'active', created_by: 'game' };
    const assignments: Assignment[] = [{ event_id: event.id, vehicle_id: vehicles[0].id }];
    const entries = buildSpeechRequestEntries([
      log(1, '4_RTW_B'),
      { ...log(2, '4_RTW_B', 'FMS5'), created_at: '2026-08-10 10:02:00' },
    ], vehicles, [event], assignments);

    expect(entries).toHaveLength(1);
    expect(entries[0].rows).toHaveLength(2);
    expect(entries[0].event?.id).toBe(1030);
    expect(entries[0].requestedAt).toBe('2026-08-10 10:01:00');
  });

  it('blendet abgearbeitete Meldungen aus', () => {
    expect(buildSpeechRequestEntries([{ ...log(1, '4_RTW_B'), state: 'inactive' }], vehicles, [], [])).toEqual([]);
  });
});
