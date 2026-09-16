import { describe, expect, it, vi } from 'vitest';
import { MapLayerScheduler, drawMarkerLayer, eventUnitProgress, NO_UNITS, type MarkerLayerInput } from './map-layers';
import type { MapView } from './mapview';
import type { EventItem, Vehicle } from './types';

function fakeFrames() {
  const callbacks: Array<() => void> = [];
  return {
    request: (cb: () => void) => {
      callbacks.push(cb);
    },
    run: () => {
      const batch = callbacks.splice(0);
      batch.forEach((cb) => cb());
    },
    count: () => callbacks.length,
  };
}

describe('Ebenen-Scheduler', () => {
  it('fasst mehrere Markierungen in einem Frame zusammen', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    scheduler.invalidate('markers');
    scheduler.invalidate('base');

    expect(frames.count()).toBe(1);
    frames.run();
    expect(draw).toHaveBeenCalledTimes(1);
    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
  });

  it('zeichnet nur die Markerebene, wenn nur Marker ungültig sind', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    frames.run();

    expect([...draw.mock.calls[0][0]]).toEqual(['markers']);
  });

  it('ohne Argument sind alle Ebenen ungültig', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate();
    frames.run();

    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
  });

  it('drawNow zeichnet sofort und verwirft den ausstehenden Frame', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    scheduler.drawNow('base');

    expect(draw).toHaveBeenCalledTimes(1);
    expect([...draw.mock.calls[0][0]].sort()).toEqual(['base', 'markers']);
    frames.run();
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('fordert nach dem Zeichnen für neue Markierungen einen neuen Frame an', () => {
    const frames = fakeFrames();
    const draw = vi.fn();
    const scheduler = new MapLayerScheduler(draw, frames.request);

    scheduler.invalidate('markers');
    frames.run();
    scheduler.invalidate('base');

    expect(frames.count()).toBe(1);
    frames.run();
    expect(draw).toHaveBeenCalledTimes(2);
    expect([...draw.mock.calls[1][0]]).toEqual(['base']);
  });
});

function recordingContext() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined;
      return (...args: unknown[]) => {
        calls.push(`${key}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`);
      };
    },
    set: () => true,
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, calls };
}

const bounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 500 };
const view: MapView = { width: 1000, height: 500, natural: { w: 1000, h: 500 }, zoom: 1, pan: { x: 0, y: 0 } };
const icon = { naturalWidth: 40, naturalHeight: 20 } as unknown as NonNullable<ReturnType<MarkerLayerInput['vehicleIcon']>>;

function vehicle(id: number, status: number): Vehicle {
  return { id, game_vehicle_id: `1_HLF_${id}`, name: `1-HLF-${id}`, type: 'HLF', modes: null, x: 100 * id, y: -100 * id, status, assigned_player_id: null };
}

function event(id: number): EventItem {
  return { id, game_event_id: String(id), name: 'Wohnungsbrand', x: 50 * id, y: -50 * id, status: 'active', created_by: 'game', created_at: '2026-09-04 18:50:00' };
}

function baseInput(overrides: Partial<MarkerLayerInput> = {}): MarkerLayerInput {
  return {
    events: [],
    vehicles: [],
    bounds,
    view,
    highlightedEventId: null,
    highlightedVehicleId: null,
    eventMarkerKind: () => 'fire',
    eventColor: () => '#f00',
    eventIcon: () => null,
    eventProgress: () => NO_UNITS,
    vehicleIcon: () => icon,
    statusColor: () => '#0f0',
    statusText: (status) => String(status),
    vehicleOutline: '#fff',
    ...overrides,
  };
}

const startingWith = (calls: string[], name: string) => calls.filter((call) => call.startsWith(`${name}(`));

describe('Markerebene', () => {
  it('zeichnet je Fahrzeug mit Grafik ein Bild, ein Statusquadrat und den Statustext', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ vehicles: [vehicle(1, 3), vehicle(2, 4)] }));

    expect(startingWith(calls, 'drawImage').length).toBe(2);
    expect(startingWith(calls, 'fillRect').length).toBe(2);
    expect(startingWith(calls, 'fillText').map((call) => call.split('(')[1].split(',')[0])).toEqual(['3', '4']);
  });

  it('zeichnet Fahrzeuge ohne Grafik als Raute', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ vehicles: [vehicle(1, 2)], vehicleIcon: () => null }));

    expect(startingWith(calls, 'drawImage').length).toBe(0);
    expect(startingWith(calls, 'lineTo').length).toBe(3);
    expect(startingWith(calls, 'closePath').length).toBe(1);
  });

  it('zeichnet das hervorgehobene Fahrzeug zuletzt', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ vehicles: [vehicle(1, 3), vehicle(2, 4)], highlightedVehicleId: 1 }));

    expect(startingWith(calls, 'fillText').map((call) => call.split('(')[1].split(',')[0])).toEqual(['4', '3']);
  });

  // Absatz, Ring und Kern sind drei Bögen; der Fortschrittsbogen und die
  // Hervorhebung kommen als vierter und fünfter dazu.
  it('zeichnet den Fortschrittsbogen nur, wenn jemand vor Ort ist', () => {
    const leer = recordingContext();
    drawMarkerLayer(leer.ctx, baseInput({ events: [event(1)] }));
    expect(startingWith(leer.calls, 'arc').length).toBe(3);

    const unterwegs = recordingContext();
    drawMarkerLayer(unterwegs.ctx, baseInput({ events: [event(1)], eventProgress: () => ({ assigned: 5, arrived: 0 }) }));
    expect(startingWith(unterwegs.calls, 'arc').length).toBe(3);

    const vorOrt = recordingContext();
    drawMarkerLayer(vorOrt.ctx, baseInput({ events: [event(1)], eventProgress: () => ({ assigned: 5, arrived: 2 }) }));
    expect(startingWith(vorOrt.calls, 'arc').length).toBe(4);
  });

  it('zeichnet bei Hervorhebung einen zusätzlichen Ring', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ events: [event(1)], highlightedEventId: 1 }));

    expect(startingWith(calls, 'arc').length).toBe(4);
  });

  it('zeichnet einen Einsatz ohne Spiel-ID gestrichelt', () => {
    const offen = recordingContext();
    drawMarkerLayer(offen.ctx, baseInput({ events: [{ ...event(1), created_by: 'frontend', game_event_id: null }] }));
    expect(startingWith(offen.calls, 'setLineDash').length).toBe(1);

    const angekommen = recordingContext();
    drawMarkerLayer(angekommen.ctx, baseInput({ events: [{ ...event(1), created_by: 'frontend', game_event_id: '18' }] }));
    expect(startingWith(angekommen.calls, 'setLineDash').length).toBe(0);
  });

  it('zeichnet das Einsatzsymbol, sobald es geladen ist', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ events: [event(1)], eventIcon: () => icon }));

    expect(startingWith(calls, 'drawImage').length).toBe(1);
  });
});

describe('Einheiten je Einsatz', () => {
  it('zählt zugeordnete und angekommene Fahrzeuge', () => {
    const progress = eventUnitProgress(
      [
        { event_id: 7, vehicle_id: 1 },
        { event_id: 7, vehicle_id: 2 },
        { event_id: 7, vehicle_id: 3 },
        { event_id: 9, vehicle_id: 4 },
      ],
      [vehicle(1, 4), vehicle(2, 3), vehicle(3, 7), vehicle(4, 3)],
    );

    // Status 4 und 7 stehen an der Einsatzstelle oder darüber hinaus
    expect(progress.get(7)).toEqual({ assigned: 3, arrived: 2 });
    expect(progress.get(9)).toEqual({ assigned: 1, arrived: 0 });
  });

  it('lässt versteckte Einheiten außen vor', () => {
    const abschlepper = { ...vehicle(2, 3), game_vehicle_id: 'ASF' };
    const streifenwagen = { ...vehicle(3, 3), game_vehicle_id: 'FuSTW' };

    const progress = eventUnitProgress(
      [
        { event_id: 7, vehicle_id: 1 },
        { event_id: 7, vehicle_id: 2 },
        { event_id: 7, vehicle_id: 3 },
      ],
      [vehicle(1, 4), abschlepper, streifenwagen],
    );

    // Abschlepper und Polizei melden nie Status 4, der Ring käme sonst nie zu
    expect(progress.get(7)).toEqual({ assigned: 1, arrived: 1 });
  });

  it('lässt ein Fahrzeug aus, das gar nicht mehr im Zustand steht', () => {
    const progress = eventUnitProgress([{ event_id: 7, vehicle_id: 99 }], [vehicle(1, 4)]);

    expect(progress.get(7)).toBeUndefined();
  });
});
