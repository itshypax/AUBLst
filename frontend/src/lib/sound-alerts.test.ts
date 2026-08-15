import { describe, expect, it } from 'vitest';
import type { SoundAlertConfig } from './sounds';
import { SoundAlertTracker } from './sound-alerts';
import type { Assignment, EventItem, LogRow, Vehicle } from './types';

const config: SoundAlertConfig = {
  unassignedVehicleStatuses: [3, 4],
  unassignedVehicleExceptions: [],
  vehicleCTimeoutSeconds: 120,
  vehicleCTimeoutOverrides: {},
  speechRequestTimeoutSeconds: 120,
};

function vehicle(id: number, status: number, statusSince?: string): Vehicle {
  return {
    id,
    game_vehicle_id: `1_TEST_${id}`,
    name: `1-TEST-${id}`,
    type: 'TEST',
    modes: null,
    x: 0,
    y: 0,
    status,
    status_since: statusSince,
    assigned_player_id: null,
  };
}

function event(): EventItem {
  return { id: 10, game_event_id: 'E1', name: 'Test', x: 0, y: 0, status: 'active', created_by: 'game' };
}

function state(vehicles: Vehicle[], assignments: Assignment[] = [], logs: LogRow[] = []) {
  return { vehicles, assignments, events: [event()], logs };
}

describe('zeitabhängige Tonhinweise', () => {
  it('meldet ein neu unzugeordnetes Fahrzeug in Status 3 oder 4 genau einmal', () => {
    const tracker = new SoundAlertTracker();
    expect(tracker.update(state([vehicle(1, 1)]), 0, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 3)]), 1_000, config)).toEqual(['unassigned-vehicle-status-3']);
    expect(tracker.update(state([vehicle(1, 3)]), 2_000, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 3)], [{ event_id: 10, vehicle_id: 1 }]), 3_000, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 4)]), 4_000, config)).toEqual(['unassigned-vehicle-status-4']);
  });

  it('fasst mehrere neue Fahrzeuge je Status zu höchstens einem Ton zusammen', () => {
    const tracker = new SoundAlertTracker();
    expect(tracker.update(state([vehicle(1, 1), vehicle(2, 1), vehicle(3, 1)]), 0, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 3), vehicle(2, 3), vehicle(3, 4)]), 1_000, config)).toEqual([
      'unassigned-vehicle-status-3',
      'unassigned-vehicle-status-4',
    ]);
  });

  it('ignoriert konfigurierte Fahrzeuge ohne Einsatz', () => {
    const tracker = new SoundAlertTracker();
    const ignored = { ...config, unassignedVehicleExceptions: ['1_TEST_1'] };
    expect(tracker.update(state([vehicle(1, 1), vehicle(2, 1)]), 0, ignored)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 3), vehicle(2, 3)]), 1_000, ignored)).toEqual([
      'unassigned-vehicle-status-3',
    ]);

    const onlyIgnored = new SoundAlertTracker();
    expect(onlyIgnored.update(state([vehicle(1, 1)]), 0, ignored)).toEqual([]);
    expect(onlyIgnored.update(state([vehicle(1, 4)]), 1_000, ignored)).toEqual([]);
  });

  it('meldet Status C nach 120 Sekunden und berücksichtigt Fahrzeugausnahmen', () => {
    const now = Date.parse('2026-08-15T12:02:01');
    const tracker = new SoundAlertTracker();
    expect(tracker.update(state([vehicle(1, 0, '2026-08-15 12:00:00')]), now, config)).toEqual(['vehicle-c-timeout']);
    expect(tracker.update(state([vehicle(1, 0, '2026-08-15 12:00:00')]), now + 1_000, config)).toEqual([]);

    const extended = { ...config, vehicleCTimeoutOverrides: { '1_TEST_2': 300, '1_TEST_3': 0 } };
    const otherTracker = new SoundAlertTracker();
    expect(otherTracker.update(state([
      vehicle(2, 0, '2026-08-15 12:00:00'),
      vehicle(3, 0, '2026-08-15 12:00:00'),
    ]), now, extended)).toEqual([]);
  });

  it('meldet einen unbearbeiteten Sprechwunsch nach 120 Sekunden genau einmal', () => {
    const tracker = new SoundAlertTracker();
    const request: LogRow = {
      id: 20,
      type: 'vehicle',
      entity_id: '1_TEST_1',
      event_id: null,
      message: 'Sprechwunsch',
      long_message: '1-TEST-1 mit Sprechwunsch',
      state: 'active',
      created_at: '2026-08-15 12:00:00',
      updated_at: '2026-08-15 12:00:00',
    };
    const now = Date.parse('2026-08-15T12:02:01');
    expect(tracker.update(state([vehicle(1, 5)], [], [request]), now, config)).toEqual(['speech-request-timeout']);
    expect(tracker.update(state([vehicle(1, 5)], [], [request]), now + 1_000, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 5)], [], [{ ...request, state: 'inactive' }]), now + 2_000, config)).toEqual([]);
    expect(tracker.update(state([vehicle(1, 5)], [], [{ ...request, id: 21, created_at: '2026-08-15 12:00:02' }]), now + 3_000, config)).toEqual(['speech-request-timeout']);
  });
});
