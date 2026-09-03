import { describe, expect, it } from 'vitest';
import type { Vehicle } from './types';
import { UnassignedVehicleWarningTracker } from './vehicle-warnings';

function vehicle(id: number, status: number, gameVehicleId = `1_TEST_${id}`): Vehicle {
  return {
    id,
    game_vehicle_id: gameVehicleId,
    name: gameVehicleId,
    type: 'TEST',
    modes: null,
    x: 0,
    y: 0,
    status,
    assigned_player_id: null,
  };
}

const config = {
  unassignedVehicleStatuses: [3, 4],
  unassignedVehicleExceptions: ['1_IGNORE_1'],
};

describe('Warnung für Fahrzeuge ohne Einsatz', () => {
  it('aktiviert Anzeige und Tonereignis nach derselben Wartezeit', () => {
    const tracker = new UnassignedVehicleWarningTracker();

    expect(tracker.update([vehicle(1, 3)], new Set(), 1_000, config).activeIds).toEqual(new Set());
    expect(tracker.update([vehicle(1, 3)], new Set(), 90_999, config).activeIds).toEqual(new Set());

    const activated = tracker.update([vehicle(1, 3)], new Set(), 91_000, config);
    expect(activated.activeIds).toEqual(new Set([1]));
    expect(activated.activatedStatuses).toEqual([3]);

    const retained = tracker.update([vehicle(1, 3)], new Set(), 92_000, config);
    expect(retained.activeIds).toEqual(new Set([1]));
    expect(retained.activatedStatuses).toEqual([]);
  });

  it('ignoriert zugeordnete und konfigurierte Ausnahmefahrzeuge', () => {
    const tracker = new UnassignedVehicleWarningTracker();
    const vehicles = [vehicle(1, 4), vehicle(2, 4, '1_IGNORE_1')];

    tracker.update(vehicles, new Set([1]), 1_000, config);
    expect(tracker.update(vehicles, new Set([1]), 100_000, config).activeIds).toEqual(new Set());
  });

  it('beginnt nach einem Statuswechsel erneut bei null', () => {
    const tracker = new UnassignedVehicleWarningTracker();
    tracker.update([vehicle(1, 3)], new Set(), 1_000, config);
    tracker.update([vehicle(1, 4)], new Set(), 60_000, config);

    expect(tracker.update([vehicle(1, 4)], new Set(), 149_999, config).activeIds).toEqual(new Set());
    expect(tracker.update([vehicle(1, 4)], new Set(), 150_000, config).activeIds).toEqual(new Set([1]));
  });
});
