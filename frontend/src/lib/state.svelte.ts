import type { Assignment, ClockTime, EventItem, Hospital, HospitalReservation, LogRow, MapBounds, Player, Vehicle } from './types';
import { cloneRoutingConfig, DEFAULT_ROUTING_CONFIG, type RoutingConfig } from './routing';
import {
  closeEventAcrossWindows,
  dispatchSelectionAcrossWindows,
  focusVehicleAcrossWindows,
  highlightAcrossWindows,
  openEventAcrossWindows,
} from './ui-sync';

export const app = $state({
  apiBase: '../backend/api.php',
  sessionToken: '',
  pin: '',
  connected: false,
  stateHealthy: false,
  logsHealthy: false,
  lastSuccessfulSync: null as number | null,
  lastSuccessfulLogPoll: null as number | null,
  sessionChanging: false,
  lastError: '',
  logError: '',
  mapBounds: { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 } as MapBounds,
  players: [] as Player[],
  vehicles: [] as Vehicle[],
  events: [] as EventItem[],
  assignments: [] as Assignment[],
  hospitals: [] as Hospital[],
  hospitalReservations: [] as HospitalReservation[],
  clock: null as ClockTime | null,
  modId: null as string | null,
  mapImageUrl: '',
  routing: cloneRoutingConfig(DEFAULT_ROUTING_CONFIG) as RoutingConfig,
  logs: [] as LogRow[],
  lastLogBatch: [] as number[],
  highlightedEventId: null as number | null,
  highlightedVehicleId: null as number | null,
  assignEvent: null as EventItem | null,
  currentEventHostedRemotely: false,
  dispatchVehicleIds: [] as number[],
  createEventPos: null as { x: number; y: number } | null,
  contextMenu: null as { x: number; y: number; vehicleId: number } | null,
  focusPoint: null as { x: number; y: number; seq: number } | null,
  confirmDialog: null as { message: string; resolve: (ok: boolean) => void } | null,
  actionsOpen: false,
  sessionOverviewOpen: false,
  speechQueueOpen: false,
  shortcutsOpen: false,
  hospitalAssignmentVehicleId: null as number | null,
  focusVehicleSearchSeq: 0,
  fitMapSeq: 0,
  soundEnabled: true,
  soundVolume: 0.7,
  soundProfile: 'standard',
  notice: null as { message: string; kind: 'success' | 'error'; id: number } | null,
});

let noticeId = 0;

export function showNotice(message: string, kind: 'success' | 'error' = 'success'): void {
  const id = ++noticeId;
  app.notice = { message, kind, id };
  window.setTimeout(() => {
    if (app.notice?.id === id) app.notice = null;
  }, 3500);
}

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    app.confirmDialog = { message, resolve };
  });
}

export function answerConfirm(ok: boolean): void {
  app.confirmDialog?.resolve(ok);
  app.confirmDialog = null;
}

let focusSeq = 0;

function focusVehicleLocally(v: Vehicle): void {
  app.focusPoint = { x: v.x, y: v.y, seq: ++focusSeq };
  app.highlightedVehicleId = v.id;
}

export function focusVehicle(v: Vehicle): void {
  setHighlightedVehicle(v.id);
  if (focusVehicleAcrossWindows(v.id)) focusVehicleLocally(v);
}

export function focusVehicleFromSync(vehicleId: number): void {
  const vehicle = app.vehicles.find((item) => item.id === vehicleId);
  if (vehicle) focusVehicleLocally(vehicle);
}

export function assignedEventForVehicle(vehicleId: number): EventItem | undefined {
  const assignment = app.assignments.find((item) => Number(item.vehicle_id) === vehicleId);
  if (!assignment) return undefined;
  return app.events.find((event) => event.id === Number(assignment.event_id) && event.status === 'active');
}

export function openVehicleMenu(vehicleId: number, x: number, y: number): void {
  app.contextMenu = { x, y, vehicleId };
}

export function closeVehicleMenu(): void {
  app.contextMenu = null;
}

export function initSettings(): void {
  const params = new URLSearchParams(location.search);
  app.apiBase = params.get('api_base') ?? localStorage.getItem('apiBase') ?? app.apiBase;
  app.sessionToken = params.get('session_token') ?? sessionStorage.getItem(tokenStorageKey(app.apiBase)) ?? '';
  app.pin = params.get('pin') ?? sessionStorage.getItem(pinStorageKey(app.apiBase, app.sessionToken)) ?? '';
  app.soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
  const storedVolume = Number(localStorage.getItem('soundVolume'));
  app.soundVolume = Number.isFinite(storedVolume) ? Math.min(1, Math.max(0, storedVolume)) : 0.7;
  app.soundProfile = localStorage.getItem('soundProfile') ?? 'standard';

  // Alte Versionen legten Zugangsdaten dauerhaft ab.
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('pin');
  persistSettings();

  if (params.has('pin') || params.has('session_token')) {
    params.delete('pin');
    params.delete('session_token');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }
}

export function persistSettings(): void {
  localStorage.setItem('apiBase', app.apiBase);
  sessionStorage.removeItem('sessionToken');
  const tokenKey = tokenStorageKey(app.apiBase);
  if (app.sessionToken) sessionStorage.setItem(tokenKey, app.sessionToken);
  else sessionStorage.removeItem(tokenKey);
  const key = pinStorageKey(app.apiBase, app.sessionToken);
  if (app.pin) sessionStorage.setItem(key, app.pin);
  else sessionStorage.removeItem(key);
}

export function persistSoundSettings(): void {
  localStorage.setItem('soundEnabled', String(app.soundEnabled));
  localStorage.setItem('soundVolume', String(app.soundVolume));
  localStorage.setItem('soundProfile', app.soundProfile);
}

function pinStorageKey(apiBase: string, token: string): string {
  let endpoint = apiBase;
  try {
    endpoint = new URL(apiBase, location.href).origin + new URL(apiBase, location.href).pathname;
  } catch {
    // Relative oder noch unvollständige Eingabe bleibt trotzdem getrennt gespeichert.
  }
  return `sessionPin:${endpoint}:${token}`;
}

function tokenStorageKey(apiBase: string): string {
  let endpoint = apiBase;
  try {
    const url = new URL(apiBase, location.href);
    endpoint = url.origin + url.pathname;
  } catch {
    // Noch unvollständige Eingaben bleiben trotzdem von anderen Zielen getrennt.
  }
  return `sessionToken:${endpoint}`;
}

export function resetSessionData(): void {
  if (app.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(app.mapImageUrl);
  app.connected = false;
  app.stateHealthy = false;
  app.logsHealthy = false;
  app.lastSuccessfulSync = null;
  app.lastSuccessfulLogPoll = null;
  app.lastError = '';
  app.logError = '';
  app.players = [];
  app.vehicles = [];
  app.events = [];
  app.assignments = [];
  app.hospitals = [];
  app.hospitalReservations = [];
  app.clock = null;
  app.modId = null;
  app.mapImageUrl = '';
  app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
  app.logs = [];
  app.lastLogBatch = [];
  app.highlightedEventId = null;
  app.highlightedVehicleId = null;
  app.assignEvent = null;
  app.currentEventHostedRemotely = false;
  app.dispatchVehicleIds = [];
  app.createEventPos = null;
  app.contextMenu = null;
  app.actionsOpen = false;
  app.sessionOverviewOpen = false;
  app.speechQueueOpen = false;
  app.shortcutsOpen = false;
  app.hospitalAssignmentVehicleId = null;
  app.focusVehicleSearchSeq = 0;
  app.fitMapSeq = 0;
  pendingSyncedEvent = null;
}

export function dataIsStale(now = Date.now()): boolean {
  return !app.lastSuccessfulSync || now - app.lastSuccessfulSync > 10_000;
}

export function canWrite(): boolean {
  return Boolean(app.sessionToken && app.stateHealthy && !dataIsStale());
}

export function setHighlightedEvent(id: number | null): void {
  app.highlightedEventId = id;
  highlightAcrossWindows('event', id);
}

export function setHighlightedVehicle(id: number | null): void {
  app.highlightedVehicleId = id;
  highlightAcrossWindows('vehicle', id);
}

export function openAssign(ev: EventItem): void {
  const placement = openEventAcrossWindows(ev.id);
  setCurrentEvent(ev, placement.hostAvailable && !placement.hostedHere);
}

function setCurrentEvent(ev: EventItem, hostedRemotely: boolean): void {
  if (app.assignEvent?.id !== ev.id) app.dispatchVehicleIds = [];
  app.assignEvent = ev;
  app.currentEventHostedRemotely = hostedRemotely;
}

export function toggleDispatchVehicle(vehicleId: number): void {
  setDispatchVehicleIds(app.dispatchVehicleIds.includes(vehicleId)
    ? app.dispatchVehicleIds.filter((id) => id !== vehicleId)
    : [...app.dispatchVehicleIds, vehicleId]);
}

export function setDispatchVehicleIds(vehicleIds: number[]): void {
  app.dispatchVehicleIds = [...vehicleIds];
  if (app.assignEvent) dispatchSelectionAcrossWindows(app.assignEvent.id, app.dispatchVehicleIds);
}

export function clearCurrentEvent(): void {
  clearCurrentEventLocally();
  closeEventAcrossWindows();
}

function clearCurrentEventLocally(): void {
  app.assignEvent = null;
  app.currentEventHostedRemotely = false;
  app.dispatchVehicleIds = [];
}

let pendingSyncedEvent: { eventId: number; hostedHere: boolean; vehicleIds: number[] } | null = null;

export function openEventFromSync(eventId: number, hostedHere: boolean, vehicleIds: number[] = []): void {
  const ev = eventById(eventId);
  if (!ev) {
    pendingSyncedEvent = { eventId, hostedHere, vehicleIds: [...vehicleIds] };
    return;
  }
  pendingSyncedEvent = null;
  setCurrentEvent(ev, !hostedHere);
  app.dispatchVehicleIds = [...vehicleIds];
}

export function reconcileSyncedEvent(): void {
  if (!pendingSyncedEvent) return;
  const pending = pendingSyncedEvent;
  const ev = eventById(pending.eventId);
  if (!ev) return;
  pendingSyncedEvent = null;
  setCurrentEvent(ev, !pending.hostedHere);
  app.dispatchVehicleIds = [...pending.vehicleIds];
}

export function closeEventFromSync(): void {
  pendingSyncedEvent = null;
  clearCurrentEventLocally();
}

export function setHighlightFromSync(entity: 'event' | 'vehicle', id: number | null): void {
  if (entity === 'event') app.highlightedEventId = id;
  else app.highlightedVehicleId = id;
}

export function setDispatchSelectionFromSync(eventId: number, vehicleIds: number[]): void {
  if (app.assignEvent?.id !== eventId) return;
  if (vehicleIds.length === app.dispatchVehicleIds.length
    && vehicleIds.every((id, index) => id === app.dispatchVehicleIds[index])) return;
  app.dispatchVehicleIds = [...vehicleIds];
}

export function eventById(id: number): EventItem | undefined {
  return app.events.find((ev) => ev.id === id);
}
