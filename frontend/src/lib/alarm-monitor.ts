import { isActionUnit, isHiddenUnit, mainTab, sortVehiclesByAlarmPriority, station } from './classify';
import { decodeEntities } from './text';
import type { Assignment, EventItem, Vehicle } from './types';

// Wache 1 bis 4 wie bisher (alles mit dieser Kennung), RD ist der gesamte
// Rettungsdienst. Ein Monitor kann mehrere davon zugleich zeigen.
export const MONITOR_STATIONS = ['1', '2', '3', '4', 'RD'] as const;
// Kein Ort, sondern ein Zusatz zur Auswahl: lässt den Rettungsdienst der
// gewählten Wachen weg, wenn ihn ein eigener Spieler disponiert. Steht in
// derselben Liste, damit URL und Speicher unverändert bleiben.
export const MONITOR_FIRE_ONLY = 'FW';
export type MonitorStation = (typeof MONITOR_STATIONS)[number] | typeof MONITOR_FIRE_ONLY;
const MONITOR_KEYS: readonly MonitorStation[] = [...MONITOR_STATIONS, MONITOR_FIRE_ONLY];
export const MONITOR_STATIONS_STORAGE = 'alarmMonitorStations';

export function isMonitorStation(value: string | null | undefined): value is MonitorStation {
  return MONITOR_KEYS.includes(value as MonitorStation);
}

// Kommaliste aus URL oder Speicher; unbekannte Werte fallen weg, die
// Reihenfolge ist immer 1, 2, 3, 4, RD, FW. Der Zusatz allein wäre keine
// Auswahl und fällt ohne Wache weg.
export function parseMonitorStations(value: string | null | undefined): MonitorStation[] {
  const seen = new Set<MonitorStation>();
  for (const part of (value ?? '').split(',')) {
    const key = part.trim().toUpperCase();
    if (isMonitorStation(key)) seen.add(key);
  }
  const items = MONITOR_KEYS.filter((item) => seen.has(item));
  return items.some((item) => item !== MONITOR_FIRE_ONLY) ? items : [];
}

export function serializeMonitorStations(stations: readonly MonitorStation[]): string {
  return parseMonitorStations(stations.join(',')).join(',');
}

export function monitorStationsLabel(stations: readonly MonitorStation[]): string {
  const items = parseMonitorStations(stations.join(',')).filter((item) => item !== MONITOR_FIRE_ONLY);
  if (!items.length) return '';
  const suffix = stations.includes(MONITOR_FIRE_ONLY) ? ' ohne RD' : '';
  if (items.every((item) => item === 'RD')) return 'RD';
  return `Wache ${items.join(' + ')}${suffix}`;
}

function belongsToStations(vehicle: Vehicle, stations: readonly MonitorStation[]): boolean {
  const rescue = mainTab(vehicle) === 'rescue';
  if (stations.includes(station(vehicle) as MonitorStation)) {
    if (!rescue || !stations.includes(MONITOR_FIRE_ONLY)) return true;
  }
  return rescue && stations.includes('RD');
}

export function monitorVehicles(vehicles: Vehicle[], stations: readonly MonitorStation[]): Vehicle[] {
  return sortVehiclesByAlarmPriority(vehicles.filter((vehicle) => belongsToStations(vehicle, stations)));
}

export function monitorEvents(
  events: EventItem[],
  assignments: Assignment[],
  vehicles: Vehicle[],
  stations: readonly MonitorStation[],
): EventItem[] {
  const vehicleIds = new Set(monitorVehicles(vehicles, stations).map((vehicle) => vehicle.id));
  const eventIds = new Set(
    assignments
      .filter((assignment) => vehicleIds.has(Number(assignment.vehicle_id)))
      .map((assignment) => Number(assignment.event_id)),
  );

  return events
    .filter((event) => event.status === 'active' && eventIds.has(event.id))
    .sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? '') || right.id - left.id);
}

export function vehiclesAssignedToEvent(
  vehicles: Vehicle[],
  assignments: Assignment[],
  eventId: number,
  stations: readonly MonitorStation[],
): Vehicle[] {
  const assignedIds = new Set(
    assignments
      .filter((assignment) => Number(assignment.event_id) === eventId)
      .map((assignment) => Number(assignment.vehicle_id)),
  );
  return monitorVehicles(vehicles, stations).filter((vehicle) => assignedIds.has(vehicle.id));
}

export function additionalVehiclesAssignedToEvent(
  vehicles: Vehicle[],
  assignments: Assignment[],
  eventId: number,
  stations: readonly MonitorStation[],
): Vehicle[] {
  const assignedIds = new Set(
    assignments
      .filter((assignment) => Number(assignment.event_id) === eventId)
      .map((assignment) => Number(assignment.vehicle_id)),
  );
  return sortVehiclesByAlarmPriority(
    vehicles.filter(
      (vehicle) =>
        assignedIds.has(vehicle.id) &&
        !belongsToStations(vehicle, stations) &&
        !isHiddenUnit(vehicle) &&
        !isActionUnit(vehicle),
    ),
  );
}

export function assignmentModes(assignments: Assignment[], eventId: number, vehicleId: number): string[] {
  return (
    assignments.find(
      (assignment) => Number(assignment.event_id) === eventId && Number(assignment.vehicle_id) === vehicleId,
    )?.alarm_modes ?? []
  );
}

// Laufband: ein Trenner zwischen den Meldungen, keine doppelten Zeichen.
export function tickerText(messages: readonly { message: string; long_message?: string | null }[]): string {
  const texts: string[] = [];
  for (const item of messages) {
    const text = decodeEntities(item.long_message || item.message).trim();
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.length ? `+++ ${texts.join(' +++ ')} +++` : '';
}
