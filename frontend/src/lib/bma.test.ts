import { describe, expect, it } from 'vitest';
import { activeEventForBma, isBmaEvent, pointInPolygon } from './bma';
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
    expect(activeEventForBma(zone, [event])?.id).toBe(1);
    expect(activeEventForBma(zone, [{ ...event, status: 'completed' }])).toBeUndefined();
  });
});
