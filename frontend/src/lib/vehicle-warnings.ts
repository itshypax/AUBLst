import type { SoundAlertConfig } from './sounds';
import type { Vehicle } from './types';

export const UNASSIGNED_VEHICLE_WARNING_MS = 90_000;

interface TrackedVehicleWarning {
  status: number;
  since: number;
  active: boolean;
}

export interface VehicleWarningUpdate {
  activeIds: Set<number>;
  activatedStatuses: number[];
}

export class UnassignedVehicleWarningTracker {
  private tracked = new Map<number, TrackedVehicleWarning>();

  reset(): void {
    this.tracked.clear();
  }

  update(
    vehicles: Vehicle[],
    assignedVehicleIds: ReadonlySet<number>,
    now: number,
    config: Pick<SoundAlertConfig, 'unassignedVehicleStatuses' | 'unassignedVehicleExceptions'>,
  ): VehicleWarningUpdate {
    const warningStatuses = new Set(config.unassignedVehicleStatuses.map(Number));
    const warningExceptions = new Set(
      config.unassignedVehicleExceptions.map((identifier) => identifier.trim().toUpperCase()),
    );
    const next = new Map<number, TrackedVehicleWarning>();
    const activeIds = new Set<number>();
    const activatedStatuses: number[] = [];

    for (const vehicle of vehicles) {
      const status = Number(vehicle.status);
      if (
        !warningStatuses.has(status)
        || assignedVehicleIds.has(vehicle.id)
        || warningExceptions.has(vehicle.game_vehicle_id.trim().toUpperCase())
      ) continue;

      const previous = this.tracked.get(vehicle.id);
      const tracked = previous?.status === status
        ? previous
        : { status, since: now, active: false };
      const active = now - tracked.since >= UNASSIGNED_VEHICLE_WARNING_MS;
      if (active) {
        activeIds.add(vehicle.id);
        if (!tracked.active && !activatedStatuses.includes(status)) activatedStatuses.push(status);
      }
      next.set(vehicle.id, { ...tracked, active });
    }

    this.tracked = next;
    return { activeIds, activatedStatuses };
  }
}
