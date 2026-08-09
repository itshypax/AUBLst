import type { Assignment, EventItem, LogRow, Vehicle } from './types';

export interface SpeechRequestEntry {
  key: string;
  row: LogRow;
  rows: LogRow[];
  vehicle?: Vehicle;
  event?: EventItem;
  requestedAt: string;
}

export function isSpeechRequest(row: LogRow): boolean {
  const signal = row.message.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, '');
  return (
    row.message.toLocaleLowerCase('de-DE').includes('sprechwunsch') ||
    row.long_message.toLocaleLowerCase('de-DE').includes('sprechwunsch') ||
    signal === '5' ||
    signal === 's5' ||
    signal === 'status5' ||
    signal === 'fms5'
  );
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]/g, '');
}

function appearsAsIdentifier(message: string, identifier: string): boolean {
  const parts = identifier
    .toLocaleLowerCase('de')
    .split(/[^a-z0-9äöüß]+/)
    .filter(Boolean);
  if (!parts.length) return false;
  const pattern = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9äöüß]*');
  return new RegExp(`(^|[^a-z0-9äöüß])${pattern}($|[^a-z0-9äöüß])`, 'i').test(message);
}

export function speechRequestVehicle(row: LogRow, vehicles: Vehicle[]): Vehicle | undefined {
  const entity = normalized(row.entity_id);
  if (entity) {
    const exact = vehicles.find((vehicle) =>
      [vehicle.game_vehicle_id, vehicle.name].some((identifier) => normalized(identifier) === entity),
    );
    if (exact) return exact;
  }

  const message = `${row.message} ${row.long_message}`;
  const candidates = vehicles
    .flatMap((vehicle) => [vehicle.game_vehicle_id, vehicle.name]
      .filter((identifier): identifier is string => Boolean(identifier))
      .map((identifier) => ({ vehicle, identifier })))
    .sort((a, b) => b.identifier.length - a.identifier.length);
  return candidates.find(({ identifier }) => appearsAsIdentifier(message, identifier))?.vehicle;
}

function eventForRequest(
  row: LogRow,
  vehicle: Vehicle | undefined,
  events: EventItem[],
  assignments: Assignment[],
): EventItem | undefined {
  if (row.event_id != null) {
    const direct = events.find((event) => event.id === Number(row.event_id) && event.status === 'active');
    if (direct) return direct;
  }
  if (!vehicle) return undefined;
  const assignment = assignments.find((item) => Number(item.vehicle_id) === vehicle.id);
  return assignment
    ? events.find((event) => event.id === Number(assignment.event_id) && event.status === 'active')
    : undefined;
}

function requestTime(row: LogRow): string {
  return row.created_at || row.updated_at;
}

export function buildSpeechRequestEntries(
  logs: LogRow[],
  vehicles: Vehicle[],
  events: EventItem[],
  assignments: Assignment[],
): SpeechRequestEntry[] {
  const grouped = new Map<string, SpeechRequestEntry>();

  for (const row of logs) {
    if (row.state !== 'active' || !isSpeechRequest(row)) continue;
    const vehicle = speechRequestVehicle(row, vehicles);
    const key = vehicle ? `vehicle:${vehicle.id}` : `message:${normalized(row.entity_id) || row.id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.rows.push(row);
      if (row.updated_at >= existing.row.updated_at) existing.row = row;
      if (requestTime(row) < existing.requestedAt) existing.requestedAt = requestTime(row);
      if (!existing.event) existing.event = eventForRequest(row, vehicle, events, assignments);
      continue;
    }
    grouped.set(key, {
      key,
      row,
      rows: [row],
      vehicle,
      event: eventForRequest(row, vehicle, events, assignments),
      requestedAt: requestTime(row),
    });
  }

  return [...grouped.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.row.id - b.row.id);
}
