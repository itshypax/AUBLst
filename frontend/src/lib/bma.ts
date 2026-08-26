import type { Point } from './mapview';
import type { BmaZone, RoutingConfig } from './routing';
import type { EventItem } from './types';

const BMA_POSITION_TOLERANCE_METERS = 25;

export function isBmaEvent(event: Pick<EventItem, 'name'>): boolean {
  return /(^|\W)bma(\W|$)|brandmeldean(?:lage|einlage)/i.test(event.name ?? '');
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crossProduct = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    const onSegment = Math.abs(crossProduct) <= Number.EPSILON * Math.max(1, segmentLength)
      && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
    if (onSegment) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function activeEventForBma(zone: BmaZone, events: EventItem[]): EventItem | undefined {
  return events.find((event) => event.status === 'active' && isBmaEvent(event) && pointInPolygon(event, zone.points));
}

function distanceToSegmentMeters(point: Point, start: Point, end: Point, scaleX: number, scaleY: number): number {
  const px = point.x * scaleX;
  const py = point.y * scaleY;
  const ax = start.x * scaleX;
  const ay = start.y * scaleY;
  const bx = end.x * scaleX;
  const by = end.y * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPolygonMeters(point: Point, polygon: Point[], scaleX: number, scaleY: number): number {
  if (pointInPolygon(point, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    distance = Math.min(distance, distanceToSegmentMeters(point, polygon[previous], polygon[current], scaleX, scaleY));
  }
  return distance;
}

export function bmaZonesForEvent(
  zones: BmaZone[],
  event: EventItem,
  routing?: Pick<RoutingConfig, 'meters_per_world_unit' | 'meters_per_world_unit_x' | 'meters_per_world_unit_y'>,
): BmaZone[] {
  if (event.status !== 'active' || !isBmaEvent(event)) return [];
  const containing = zones.filter((zone) => pointInPolygon(event, zone.points));
  if (containing.length || !routing || !zones.length) return containing;

  const fallbackScale = Number(routing.meters_per_world_unit);
  const scaleX = Number(routing.meters_per_world_unit_x ?? fallbackScale);
  const scaleY = Number(routing.meters_per_world_unit_y ?? fallbackScale);
  if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) return [];

  let nearest: { zone: BmaZone; distance: number } | undefined;
  for (const zone of zones) {
    const distance = distanceToPolygonMeters(event, zone.points, scaleX, scaleY);
    if (!nearest || distance < nearest.distance) nearest = { zone, distance };
  }
  return nearest && nearest.distance <= BMA_POSITION_TOLERANCE_METERS ? [nearest.zone] : [];
}
