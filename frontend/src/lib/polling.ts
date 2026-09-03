import { api, apiGet, fetchMapImage } from './api';
import { advanceLogCursor, INITIAL_LOG_CURSOR, mergeLogRows } from './log-stream';
import { SoundAlertTracker } from './sound-alerts';
import { soundCuesForLogs } from './sound-events';
import { app, clearCurrentEvent, persistSettings, resetSessionData } from './state.svelte';
import { getSoundAlertConfig, playPhone, playSoundCue, playSoundCues } from './sounds';
import type { LogRow, MapBounds, MapContentRect, StateResponse, StatusHistoryResponse, VehicleStatusChange } from './types';
import { cloneRoutingConfig, DEFAULT_ROUTING_CONFIG, type RoutingConfig } from './routing';
import {
  broadcastLogAcknowledged,
  broadcastLogDismissed,
  broadcastPollingLogs,
  broadcastPollingSnapshot,
  broadcastPollingState,
  broadcastStatusHistory,
  isPollingLeader,
  requestPollingSnapshot,
  setPollingScope,
  startPollingSync,
  type PollingSnapshot,
} from './polling-sync';
import { uiSyncScope } from './ui-sync';
import { startRealtimeStream } from './realtime';
import { recordAnonymousMetrics } from './telemetry';
import { notifyNewIncidents, notifySpeechRequests } from './notifications';
import { bmaZonesForEvent } from './bma';
import { normalizeSessionToken } from './session-token';

const STATE_INTERVAL = 3_000;
const LOG_INTERVAL = 2_000;
const STATUS_HISTORY_INTERVAL = 15_000;
const HIDDEN_INTERVAL = 15_000;
const MAX_BACKOFF = 30_000;
const MAX_LOG_ROWS = 500;

export interface PollingProfile {
  stateAction: 'state' | 'monitor_state';
  pollsLogs: boolean;
  pollsStatusHistory: boolean;
  usesRealtime: boolean;
}

export function pollingProfile(readOnly: boolean): PollingProfile {
  return readOnly
    ? { stateAction: 'monitor_state', pollsLogs: false, pollsStatusHistory: false, usesRealtime: false }
    : { stateAction: 'state', pollsLogs: true, pollsStatusHistory: true, usesRealtime: true };
}

function sameMapBounds(left: MapBounds, right: MapBounds): boolean {
  return (
    left.min_x === right.min_x && left.min_y === right.min_y && left.max_x === right.max_x && left.max_y === right.max_y
  );
}

function sameMapContentRect(left: MapContentRect | null, right: MapContentRect | null): boolean {
  if (left === null || right === null) return left === right;
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

let lastEventIds = new Set<number>();
let eventsInitialized = false;
let logsInitialized = false;
let logCursor = INITIAL_LOG_CURSOR;
let stateFailures = 0;
let logFailures = 0;
let statusHistoryFailures = 0;
let stateTimer = 0;
let logTimer = 0;
let statusHistoryTimer = 0;
let connectionTimer = 0;
let stateController: AbortController | null = null;
let logController: AbortController | null = null;
let statusHistoryController: AbortController | null = null;
let generation = 0;
let started = false;
let readOnlySession =
  typeof location !== 'undefined' &&
  (new URLSearchParams(location.search).get('view') === 'monitor' ||
    new URLSearchParams(location.search).get('monitor') === '1');
let lastState: StateResponse | null = null;
let realtimeConnected = false;
let stopRealtime: (() => void) | null = null;
let realtimeRefreshTimer = 0;
const dismissedLogVersions = new Map<number, string>();
const soundAlertTracker = new SoundAlertTracker();

function resetCursors(): void {
  lastEventIds = new Set();
  eventsInitialized = false;
  logsInitialized = false;
  logCursor = INITIAL_LOG_CURSOR;
  stateFailures = 0;
  logFailures = 0;
  statusHistoryFailures = 0;
  dismissedLogVersions.clear();
  soundAlertTracker.reset();
}

function applyDismissedLogState(rows: LogRow[]): LogRow[] {
  return rows.map((row) => {
    const dismissedVersion = dismissedLogVersions.get(row.id);
    if (dismissedVersion === undefined) return row;
    if (row.updated_at > dismissedVersion) {
      dismissedLogVersions.delete(row.id);
      return row;
    }
    return { ...row, state: 'inactive' as const };
  });
}

function isChangedLogVersion(row: LogRow): boolean {
  const existing = app.logs.find((item) => item.id === row.id);
  return !existing || existing.updated_at !== row.updated_at || existing.state !== row.state;
}

function isAlertableLogVersion(row: LogRow): boolean {
  const existing = app.logs.find((item) => item.id === row.id);
  if (!existing) return true;
  if (!isChangedLogVersion(row)) return false;
  const acknowledgementOnly =
    existing.state === row.state &&
    existing.message === row.message &&
    existing.long_message === row.long_message &&
    existing.event_id === row.event_id &&
    existing.occurrence_id === row.occurrence_id &&
    Boolean(existing.acknowledged) !== Boolean(row.acknowledged);
  return !acknowledgementOnly;
}

function nextDelay(base: number, failures: number): number {
  if (document.hidden) return HIDDEN_INTERVAL;
  if (realtimeConnected && failures === 0) return HIDDEN_INTERVAL;
  return Math.min(MAX_BACKOFF, base * Math.max(1, 2 ** failures));
}

function stopRealtimeStream(): void {
  stopRealtime?.();
  stopRealtime = null;
  realtimeConnected = false;
  clearTimeout(realtimeRefreshTimer);
}

function currentPollingProfile(): PollingProfile {
  return pollingProfile(readOnlySession);
}

function currentPollingScope(): string {
  const base = uiSyncScope(app.apiBase, app.sessionToken);
  if (!base) return '';
  return `${base}:${readOnlySession ? 'monitor' : 'control-room'}`;
}

function ensureRealtimeStream(): void {
  if (!currentPollingProfile().usesRealtime || stopRealtime || !isPollingLeader() || !app.sessionToken) return;
  stopRealtime = startRealtimeStream({
    onStatus: (connected) => {
      realtimeConnected = connected;
    },
    onChange: () => {
      clearTimeout(realtimeRefreshTimer);
      realtimeRefreshTimer = window.setTimeout(() => {
        void refreshState();
        if (currentPollingProfile().pollsLogs) void pollLogs();
      }, 100);
    },
  });
}

function scheduleState(delay = nextDelay(STATE_INTERVAL, stateFailures)): void {
  if (!isPollingLeader()) return;
  const scheduledGeneration = generation;
  clearTimeout(stateTimer);
  stateTimer = window.setTimeout(async () => {
    if (scheduledGeneration !== generation) return;
    await refreshState();
    if (scheduledGeneration === generation) scheduleState();
  }, delay);
}

function scheduleLogs(delay = nextDelay(LOG_INTERVAL, logFailures)): void {
  if (!isPollingLeader()) return;
  const scheduledGeneration = generation;
  clearTimeout(logTimer);
  logTimer = window.setTimeout(async () => {
    if (scheduledGeneration !== generation) return;
    await pollLogs();
    if (scheduledGeneration === generation) scheduleLogs();
  }, delay);
}

function scheduleStatusHistory(delay = nextDelay(STATUS_HISTORY_INTERVAL, statusHistoryFailures)): void {
  if (!isPollingLeader()) return;
  const scheduledGeneration = generation;
  clearTimeout(statusHistoryTimer);
  statusHistoryTimer = window.setTimeout(async () => {
    if (scheduledGeneration !== generation) return;
    await refreshStatusHistory();
    if (scheduledGeneration === generation) scheduleStatusHistory();
  }, delay);
}

function sessionIsWaiting(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase('en-US') : '';
  return message.includes('session not found') || message.includes('waiting for initial sync');
}

function scheduleConnectionRetry(): void {
  if (!isPollingLeader()) return;
  const scheduledGeneration = generation;
  clearTimeout(connectionTimer);
  connectionTimer = window.setTimeout(
    () => {
      if (scheduledGeneration !== generation || !app.sessionToken || app.stateHealthy) return;
      void connectCurrentSession();
    },
    document.hidden ? HIDDEN_INTERVAL : STATE_INTERVAL,
  );
}

function restartLoops(runImmediately: boolean): void {
  clearTimeout(stateTimer);
  clearTimeout(logTimer);
  clearTimeout(statusHistoryTimer);
  clearTimeout(connectionTimer);
  if (!app.sessionToken || !isPollingLeader()) return;
  if (!app.stateHealthy) {
    if (runImmediately) void connectCurrentSession();
    else scheduleConnectionRetry();
    return;
  }
  const profile = currentPollingProfile();
  if (profile.usesRealtime) ensureRealtimeStream();
  if (runImmediately) {
    void refreshState().finally(() => scheduleState());
    if (profile.pollsLogs) void pollLogs().finally(() => scheduleLogs());
    if (profile.pollsStatusHistory) void refreshStatusHistory().finally(() => scheduleStatusHistory());
  } else {
    scheduleState();
    if (profile.pollsLogs) scheduleLogs();
    if (profile.pollsStatusHistory) scheduleStatusHistory();
  }
}

async function connectCurrentSession(): Promise<void> {
  if (!app.sessionToken || !isPollingLeader()) return;
  clearTimeout(connectionTimer);
  const requestGeneration = generation;
  if (!readOnlySession) {
    try {
      await api('session_validate', {}, { requireFresh: false });
    } catch (error) {
      if (requestGeneration !== generation) return;
      app.connected = false;
      app.stateHealthy = false;
      app.logsHealthy = false;
      app.lastError = (error as Error).message;
      if (sessionIsWaiting(error)) scheduleConnectionRetry();
      return;
    }
  }
  if (requestGeneration !== generation) return;
  const profile = currentPollingProfile();
  const logRequest = profile.pollsLogs
    ? pollLogs().finally(() => {
        if (requestGeneration === generation) scheduleLogs();
      })
    : null;
  const statusHistoryRequest = profile.pollsStatusHistory
    ? refreshStatusHistory().finally(() => {
        if (requestGeneration === generation) scheduleStatusHistory();
      })
    : null;
  await refreshState();
  if (requestGeneration === generation) {
    if (app.stateHealthy && profile.usesRealtime) ensureRealtimeStream();
    scheduleState();
  }
  if (logRequest) void logRequest;
  if (statusHistoryRequest) void statusHistoryRequest;
}

export async function switchSession(
  apiBase: string,
  token: string,
  pin: string,
  options: { readOnly?: boolean } = {},
): Promise<void> {
  generation += 1;
  stateController?.abort();
  logController?.abort();
  statusHistoryController?.abort();
  clearTimeout(stateTimer);
  clearTimeout(logTimer);
  clearTimeout(statusHistoryTimer);
  clearTimeout(connectionTimer);
  stopRealtimeStream();
  app.sessionChanging = true;
  resetSessionData();
  resetCursors();
  app.apiBase = apiBase.trim() || '../backend/api.php';
  app.sessionToken = normalizeSessionToken(token);
  app.pin = pin.trim();
  readOnlySession = options.readOnly ?? false;
  persistSettings();
  lastState = null;
  setPollingScope(currentPollingScope());
  try {
    if (started && app.sessionToken && isPollingLeader()) {
      await connectCurrentSession();
    } else if (started && app.sessionToken) {
      requestPollingSnapshot();
    }
  } finally {
    app.sessionChanging = false;
  }
}

async function applyState(
  data: StateResponse,
  playEventSounds: boolean,
  receivedAt = Date.now(),
  signal?: AbortSignal,
): Promise<void> {
  const applyGeneration = generation;
  const playControlRoomSounds = playEventSounds && !readOnlySession;
  const mapBoundsChanged = !sameMapBounds(app.mapBounds, data.session.map_bounds);
  const nextMapContentRect = data.session.map_content_rect ?? null;
  const mapContentRectChanged = !sameMapContentRect(app.mapContentRect, nextMapContentRect);
  app.mapBounds = data.session.map_bounds;
  app.mapContentRect = nextMapContentRect;
  app.players = data.players ?? [];
  app.vehicles = data.vehicles ?? [];
  app.events = data.events ?? [];
  app.assignments = data.assignments ?? [];
  if (data.status_history) app.statusHistory = data.status_history;
  app.hospitals = data.hospitals ?? [];
  app.hospitalReservations = data.hospital_reservations ?? [];
  app.monitorHospitalCapacities = data.monitor_hospital_capacities ?? [];
  app.monitorShowHospitalCapacity = Boolean(data.session.monitor_show_hospital_capacity);
  app.clock = data.time ?? null;
  app.connected = true;
  app.stateHealthy = true;
  app.lastSuccessfulSync = receivedAt;
  app.lastError = '';
  stateFailures = 0;
  lastState = data;

  if (playControlRoomSounds) {
    const alertCues = soundAlertTracker.update(
      {
        vehicles: app.vehicles,
        assignments: app.assignments,
        events: app.events,
        logs: app.logs,
      },
      receivedAt,
      getSoundAlertConfig(),
    );
    if (alertCues.length) void playSoundCues(alertCues);
  }

  const newMod = data.session.mod_id ?? null;
  const nextRoutingVersion = data.session.routing_version ?? null;
  const modChanged = app.modId !== newMod;
  const routingVersionChanged = Boolean(newMod && nextRoutingVersion && app.routingVersion !== nextRoutingVersion);
  const mapMissing = Boolean(newMod && !app.mapImageUrl);
  if (modChanged || routingVersionChanged || mapMissing || (newMod && (mapBoundsChanged || mapContentRectChanged))) {
    const reloadMapImage = modChanged || mapMissing || mapContentRectChanged;
    if (modChanged && app.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(app.mapImageUrl);
    app.modId = newMod;
    if (newMod) {
      try {
        const [mapImageUrl, routing] = await Promise.all([
          reloadMapImage ? fetchMapImage(signal) : Promise.resolve(app.mapImageUrl),
          apiGet<RoutingConfig>('routing_get', {}, { signal, requireFresh: false }),
        ]);
        if (signal?.aborted || applyGeneration !== generation) {
          if (reloadMapImage && mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(mapImageUrl);
          return;
        }
        app.mapImageUrl = mapImageUrl;
        app.routing = routing;
        app.routingVersion = nextRoutingVersion;
      } catch (error) {
        if (signal?.aborted || applyGeneration !== generation) return;
        if (reloadMapImage) app.mapImageUrl = '';
        app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
        app.lastError = `Kartendaten: ${(error as Error).message}`;
      }
    } else {
      app.mapImageUrl = '';
      app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
      app.routingVersion = null;
    }
  }

  const activeEvents = app.events.filter((event) => event.status === 'active');
  const ids = new Set(activeEvents.map((event) => event.id));
  if (playControlRoomSounds && eventsInitialized) {
    const fresh = activeEvents.filter((event) => !lastEventIds.has(event.id) && event.created_by === 'game');
    if (fresh.length) {
      void playPhone();
      notifyNewIncidents(fresh);
      if (fresh.some((event) => bmaZonesForEvent(app.routing.bma_zones ?? [], event, app.routing).length))
        void playSoundCue('bma-alarm');
    }
    if ([...lastEventIds].some((id) => !ids.has(id))) void playSoundCue('incident-completed');
  }
  eventsInitialized = true;
  lastEventIds = ids;

  if (app.highlightedEventId != null && !ids.has(app.highlightedEventId)) app.highlightedEventId = null;
  if (app.assignEvent && !ids.has(app.assignEvent.id)) clearCurrentEvent();
}

export async function refreshState(): Promise<void> {
  if (!app.sessionToken) return;
  stateController?.abort();
  const controller = new AbortController();
  stateController = controller;
  const requestGeneration = generation;
  const startedAt = performance.now();
  try {
    const profile = currentPollingProfile();
    const data = await apiGet<StateResponse>(profile.stateAction, {}, { signal: controller.signal });
    if (requestGeneration !== generation) return;
    const receivedAt = Date.now();
    await applyState(data, isPollingLeader(), receivedAt, controller.signal);
    if (requestGeneration !== generation) return;
    broadcastPollingState(data, receivedAt);
    if (!readOnlySession) recordAnonymousMetrics(performance.now() - startedAt, data.events?.length ?? 0);
  } catch (error) {
    if (controller.signal.aborted || requestGeneration !== generation) return;
    stateFailures += 1;
    app.connected = false;
    app.stateHealthy = false;
    app.lastError = (error as Error).message;
    broadcastPollingSnapshot();
  } finally {
    if (stateController === controller) stateController = null;
  }
}

export async function pollLogs(): Promise<void> {
  if (!app.sessionToken) return;
  logController?.abort();
  const controller = new AbortController();
  logController = controller;
  const requestGeneration = generation;
  const incomingIds: number[] = [];
  const incomingRows: LogRow[] = [];
  const broadcastRows: LogRow[] = [];
  // Den letzten Zeitstempel erneut lesen: Eine ältere Zeilen-ID kann in derselben
  // Sekunde geändert worden sein, nachdem der Cursor schon daran vorbeigelaufen ist.
  let pageCursor = { timestamp: logCursor.timestamp, id: 0 };
  let nextCursor = logCursor;
  try {
    for (let page = 0; page < 5; page += 1) {
      const data = await apiGet<{ logs: LogRow[] }>(
        'logs',
        { since: pageCursor.timestamp, since_id: pageCursor.id },
        { signal: controller.signal },
      );
      if (requestGeneration !== generation) return;
      const rows = data.logs ?? [];
      if (!rows.length) break;
      const applicableRows = applyDismissedLogState(rows);
      const activeRows = applicableRows.filter((row) => row.state === 'active' && isAlertableLogVersion(row));
      app.logs = mergeLogRows(app.logs, applicableRows, MAX_LOG_ROWS);
      incomingIds.push(...activeRows.map((row) => row.id));
      incomingRows.push(...activeRows);
      broadcastRows.push(...applicableRows);
      pageCursor = advanceLogCursor(pageCursor, rows);
      const advanced = advanceLogCursor(nextCursor, rows);
      if (
        advanced.timestamp > nextCursor.timestamp ||
        (advanced.timestamp === nextCursor.timestamp && advanced.id > nextCursor.id)
      )
        nextCursor = advanced;
      if (rows.length < 100) break;
    }
    logCursor = nextCursor;
    app.logsHealthy = true;
    const receivedAt = Date.now();
    app.lastSuccessfulLogPoll = receivedAt;
    app.logError = '';
    logFailures = 0;
    if (logsInitialized && incomingIds.length) {
      app.lastLogBatch = incomingIds;
      void playSoundCues(soundCuesForLogs(incomingRows));
      notifySpeechRequests(incomingRows);
    } else {
      app.lastLogBatch = [];
    }
    logsInitialized = true;
    broadcastPollingLogs(broadcastRows, logCursor, receivedAt);
  } catch (error) {
    if (controller.signal.aborted || requestGeneration !== generation) return;
    logFailures += 1;
    app.logsHealthy = false;
    app.logError = (error as Error).message;
    broadcastPollingSnapshot();
  } finally {
    if (logController === controller) logController = null;
  }
}

export async function refreshStatusHistory(): Promise<void> {
  if (!app.sessionToken || !currentPollingProfile().pollsStatusHistory) return;
  statusHistoryController?.abort();
  const controller = new AbortController();
  statusHistoryController = controller;
  const requestGeneration = generation;
  try {
    const data = await apiGet<StatusHistoryResponse>('status_history', {}, { signal: controller.signal });
    if (requestGeneration !== generation) return;
    const rows: VehicleStatusChange[] = data.status_history ?? [];
    app.statusHistory = rows;
    statusHistoryFailures = 0;
    broadcastStatusHistory(rows);
  } catch {
    if (!controller.signal.aborted && requestGeneration === generation) statusHistoryFailures += 1;
  } finally {
    if (statusHistoryController === controller) statusHistoryController = null;
  }
}

export async function dismissLog(id: number): Promise<void> {
  const result = await api<{ ok: boolean; ids?: number[]; updated_at?: string | null }>(
    'log_viewed',
    { mid: id },
    { requireFresh: true },
  );
  const updatedAt = result.updated_at || app.logs.find((row) => row.id === id)?.updated_at || '';
  const dismissedIds = result.ids?.length ? result.ids : [id];
  for (const dismissedId of dismissedIds) {
    markLogDismissed(dismissedId, updatedAt);
    broadcastLogDismissed(dismissedId, updatedAt);
  }
}

export async function acknowledgeLog(id: number): Promise<void> {
  const result = await api<{ ok: boolean; ids?: number[]; updated_at?: string | null }>(
    'log_acknowledge',
    { mid: id },
    { requireFresh: true },
  );
  const updatedAt = result.updated_at || app.logs.find((row) => row.id === id)?.updated_at || '';
  const acknowledgedIds = result.ids?.length ? result.ids : [id];
  for (const acknowledgedId of acknowledgedIds) {
    markLogAcknowledged(acknowledgedId, updatedAt);
    broadcastLogAcknowledged(acknowledgedId, updatedAt);
  }
}

function markLogAcknowledged(id: number, updatedAt: string): void {
  app.logs = app.logs.map((row) =>
    row.id === id ? { ...row, acknowledged: true, updated_at: updatedAt || row.updated_at } : row,
  );
  app.lastLogBatch = app.lastLogBatch.filter((item) => item !== id);
}

function markLogDismissed(id: number, updatedAt: string): void {
  const current = dismissedLogVersions.get(id);
  if (current === undefined || updatedAt > current) dismissedLogVersions.set(id, updatedAt);
  app.logs = app.logs.map((row) => (row.id === id ? { ...row, state: 'inactive' as const } : row));
  app.lastLogBatch = app.lastLogBatch.filter((item) => item !== id);
}

export function startPolling(): void {
  if (started) return;
  started = true;
  startPollingSync({
    onLeaderChange: (leader) => {
      soundAlertTracker.reset();
      stateController?.abort();
      logController?.abort();
      statusHistoryController?.abort();
      clearTimeout(stateTimer);
      clearTimeout(logTimer);
      clearTimeout(statusHistoryTimer);
      clearTimeout(connectionTimer);
      stopRealtimeStream();
      if (leader) restartLoops(true);
    },
    onState: (state, receivedAt) => {
      void applyState(state, false, receivedAt);
    },
    onLogs: (rows, cursor, receivedAt) => {
      app.logs = mergeLogRows(app.logs, applyDismissedLogState(rows), MAX_LOG_ROWS);
      logCursor = cursor;
      app.logsHealthy = true;
      app.lastSuccessfulLogPoll = receivedAt;
      app.logError = '';
      logsInitialized = true;
    },
    onStatusHistory: (rows) => {
      app.statusHistory = rows;
    },
    onLogAcknowledged: markLogAcknowledged,
    onLogDismissed: markLogDismissed,
    onSnapshot: (snapshot) => {
      void applyPollingSnapshot(snapshot);
    },
    snapshot: pollingSnapshot,
  });
  setPollingScope(currentPollingScope());
  document.addEventListener('visibilitychange', () => restartLoops(!document.hidden));
  if (app.sessionToken && isPollingLeader()) {
    app.sessionChanging = true;
    void connectCurrentSession().finally(() => (app.sessionChanging = false));
  } else if (app.sessionToken) {
    requestPollingSnapshot();
  }
}

function pollingSnapshot(): PollingSnapshot {
  return {
    state: lastState,
    logs: app.logs,
    statusHistory: app.statusHistory,
    logCursor,
    stateHealthy: app.stateHealthy,
    logsHealthy: app.logsHealthy,
    lastSuccessfulSync: app.lastSuccessfulSync,
    lastSuccessfulLogPoll: app.lastSuccessfulLogPoll,
    lastError: app.lastError,
    logError: app.logError,
  };
}

async function applyPollingSnapshot(snapshot: PollingSnapshot): Promise<void> {
  if (snapshot.state) await applyState(snapshot.state, false, snapshot.lastSuccessfulSync ?? Date.now());
  app.logs = applyDismissedLogState(snapshot.logs);
  app.statusHistory = snapshot.statusHistory;
  logCursor = snapshot.logCursor;
  app.stateHealthy = snapshot.stateHealthy;
  app.logsHealthy = snapshot.logsHealthy;
  app.connected = snapshot.stateHealthy;
  app.lastSuccessfulSync = snapshot.lastSuccessfulSync;
  app.lastSuccessfulLogPoll = snapshot.lastSuccessfulLogPoll;
  app.lastError = snapshot.lastError;
  app.logError = snapshot.logError;
  logsInitialized = snapshot.logs.length > 0;
}
