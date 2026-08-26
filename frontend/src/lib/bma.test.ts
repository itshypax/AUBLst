import { describe, expect, it } from 'vitest';
import { activeEventForBma, bmaZonesForEvent, isBmaEvent, pointInPolygon } from './bma';
import type { BmaZone } from './routing';
import type { EventItem } from './types';

const zone: BmaZone = { id: 'rathaus', name: 'Rathaus', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
const event: EventItem = { id: 1, game_event_id: '1', name: 'BMA Rathaus', x: 5, y: 5, status: 'active', created_by: 'game' };

describe('BMA-Zonen', () => {
  it('erkennt BMA- und Brandmeldeanlagen-Einsätze', () => {
    expect(isBmaEvent(event)).toBe(true);
    expect(isBmaEvent({ name: 'Brandmeldeanlage ausgelöst' })).toBe(true);
    expect(isBmaEvent({ name: 'Verkehrsunfall' })).toBe(false);
  });

  it('ordnet nur aktive passende Einsätze innerhalb der Zone zu', () => {
    expect(pointInPolygon(event, zone.points)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 5 }, zone.points)).toBe(true);
    expect(activeEventForBma(zone, [event])?.id).toBe(1);
    expect(activeEventForBma(zone, [{ ...event, status: 'completed' }])).toBeUndefined();
  });

  it('ordnet leicht versetzte Spielkoordinaten nur der nächsten BMA zu', () => {
    const nextZone: BmaZone = { id: 'wache', name: 'Wache', points: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }] };
    const routing = { meters_per_world_unit: 1 };

    expect(bmaZonesForEvent([zone, nextZone], { ...event, x: 11, y: 5 }, routing)).toEqual([zone]);
    expect(bmaZonesForEvent([zone, nextZone], { ...event, x: 40, y: 5 }, routing)).toEqual([nextZone]);
    expect(bmaZonesForEvent([zone, nextZone], { ...event, x: 60, y: 5 }, routing)).toEqual([]);
  });
});
