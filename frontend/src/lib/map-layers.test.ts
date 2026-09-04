import { describe, expect, it, vi } from 'vitest';
import { MapLayerScheduler, drawMarkerLayer, type MarkerLayerInput } from './map-layers';
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

  it('zeichnet je Einsatz einen Kreis und bei Hervorhebung zusätzlich einen Ring', () => {
    const plain = recordingContext();
    drawMarkerLayer(plain.ctx, baseInput({ events: [event(1)] }));
    expect(startingWith(plain.calls, 'arc').length).toBe(1);

    const highlighted = recordingContext();
    drawMarkerLayer(highlighted.ctx, baseInput({ events: [event(1)], highlightedEventId: 1 }));
    expect(startingWith(highlighted.calls, 'arc').length).toBe(2);
  });

  it('zeichnet das Einsatzsymbol, sobald es geladen ist', () => {
    const { ctx, calls } = recordingContext();

    drawMarkerLayer(ctx, baseInput({ events: [event(1)], eventIcon: () => icon }));

    expect(startingWith(calls, 'drawImage').length).toBe(1);
  });
});
