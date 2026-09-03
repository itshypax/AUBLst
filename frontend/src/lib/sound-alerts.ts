import { buildSpeechRequestEntries } from './speech-requests';
import type { SoundAlertConfig, SoundCue } from './sounds';
import type { Assignment, EventItem, LogRow, Vehicle } from './types';
import { UnassignedVehicleWarningTracker } from './vehicle-warnings';

interface SoundAlertState {
  vehicles: Vehicle[];
  assignments: Assignment[];
  events: EventItem[];
  logs: LogRow[];
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : null;
}

function addCue(cues: SoundCue[], cue: SoundCue): void {
  if (!cues.includes(cue)) cues.push(cue);
}

export class SoundAlertTracker {
  private unassignedVehicleWarnings = new UnassignedVehicleWarningTracker();
  private cStatusSince = new Map<number, number>();
  private announcedCStatuses = new Set<number>();
  private announcedSpeechRequests = new Set<string>();

  reset(): void {
    this.unassignedVehicleWarnings.reset();
    this.cStatusSince.clear();
    this.announcedCStatuses.clear();
    this.announcedSpeechRequests.clear();
  }

  update(state: SoundAlertState, now: number, config: SoundAlertConfig): SoundCue[] {
    const cues: SoundCue[] = [];
    const activeEventIds = new Set(state.events
      .filter((event) => event.status === 'active')
      .map((event) => Number(event.id)));
    const assignedVehicleIds = new Set(state.assignments
      .filter((assignment) => activeEventIds.has(Number(assignment.event_id)))
      .map((assignment) => Number(assignment.vehicle_id)));
    const vehicleWarnings = this.unassignedVehicleWarnings.update(
      state.vehicles,
      assignedVehicleIds,
      now,
      config,
    );
    for (const status of vehicleWarnings.activatedStatuses) {
      if (status === 3) addCue(cues, 'unassigned-vehicle-status-3');
      if (status === 4) addCue(cues, 'unassigned-vehicle-status-4');
    }

    const vehiclesInC = new Set<number>();
    for (const vehicle of state.vehicles) {
      if (Number(vehicle.status) !== 0) continue;
      vehiclesInC.add(vehicle.id);
      const recordedSince = timestamp(vehicle.status_since);
      const previousSince = this.cStatusSince.get(vehicle.id);
      const since = recordedSince ?? previousSince ?? now;
      if (recordedSince !== null && previousSince !== undefined && recordedSince !== previousSince) {
        this.announcedCStatuses.delete(vehicle.id);
      }
      this.cStatusSince.set(vehicle.id, since);

      const override = config.vehicleCTimeoutOverrides[vehicle.game_vehicle_id.trim().toUpperCase()];
      const timeoutSeconds = override ?? config.vehicleCTimeoutSeconds;
      if (timeoutSeconds > 0 && now - since > timeoutSeconds * 1000 && !this.announcedCStatuses.has(vehicle.id)) {
        addCue(cues, 'vehicle-c-timeout');
        this.announcedCStatuses.add(vehicle.id);
      }
    }
    for (const id of this.cStatusSince.keys()) {
      if (vehiclesInC.has(id)) continue;
      this.cStatusSince.delete(id);
      this.announcedCStatuses.delete(id);
    }

    const activeSpeechRequests = new Set<string>();
    for (const entry of buildSpeechRequestEntries(state.logs, state.vehicles, state.events, state.assignments)) {
      const occurrence = `${entry.key}:${entry.requestedAt}`;
      activeSpeechRequests.add(occurrence);
      const requestedAt = timestamp(entry.requestedAt);
      if (
        config.speechRequestTimeoutSeconds > 0
        && requestedAt !== null
        && now - requestedAt > config.speechRequestTimeoutSeconds * 1000
        && !this.announcedSpeechRequests.has(occurrence)
      ) {
        addCue(cues, 'speech-request-timeout');
        this.announcedSpeechRequests.add(occurrence);
      }
    }
    for (const occurrence of this.announcedSpeechRequests) {
      if (!activeSpeechRequests.has(occurrence)) this.announcedSpeechRequests.delete(occurrence);
    }

    return cues;
  }
}
