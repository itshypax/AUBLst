import type { Point } from './mapview';
import type { BmaZone } from './routing';
import type { EventItem } from './types';

export function isBmaEvent(event: Pick<EventItem, 'name'>): boolean {
  return /(^|\W)bma(\W|$)|brandmeldean(?:lage|einlage)/i.test(event.name ?? '');
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function activeEventForBma(zone: BmaZone, events: EventItem[]): EventItem | undefined {
  return events.find((event) => event.status === 'active' && isBmaEvent(event) && pointInPolygon(event, zone.points));
}

export function bmaZonesForEvent(zones: BmaZone[], event: EventItem): BmaZone[] {
  if (event.status !== 'active' || !isBmaEvent(event)) return [];
  return zones.filter((zone) => pointInPolygon(event, zone.points));
}
