import { sortVehiclesByAlarmPriority, station } from './classify';
import type { Assignment, EventItem, Vehicle } from './types';

export const MONITOR_STATIONS = ['1', '2', '3', '4'] as const;
export type MonitorStation = (typeof MONITOR_STATIONS)[number];

export function isMonitorStation(value: string | null | undefined): value is MonitorStation {
  return MONITOR_STATIONS.includes(value as MonitorStation);
}

export function monitorVehicles(vehicles: Vehicle[], selectedStation: MonitorStation): Vehicle[] {
  return sortVehiclesByAlarmPriority(vehicles.filter((vehicle) => station(vehicle) === selectedStation));
}

export function monitorEvents(
  events: EventItem[],
  assignments: Assignment[],
  vehicles: Vehicle[],
  selectedStation: MonitorStation,
): EventItem[] {
  const vehicleIds = new Set(monitorVehicles(vehicles, selectedStation).map((vehicle) => vehicle.id));
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
  selectedStation: MonitorStation,
): Vehicle[] {
  const assignedIds = new Set(
    assignments
      .filter((assignment) => Number(assignment.event_id) === eventId)
      .map((assignment) => Number(assignment.vehicle_id)),
  );
  return monitorVehicles(vehicles, selectedStation).filter((vehicle) => assignedIds.has(vehicle.id));
}

export function assignmentModes(assignments: Assignment[], eventId: number, vehicleId: number): string[] {
  return (
    assignments.find(
      (assignment) => Number(assignment.event_id) === eventId && Number(assignment.vehicle_id) === vehicleId,
    )?.alarm_modes ?? []
  );
}
