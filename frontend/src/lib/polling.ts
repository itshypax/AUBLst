import { api, apiGet, fetchMapImage } from './api';
import { advanceLogCursor, INITIAL_LOG_CURSOR, mergeLogRows } from './log-stream';
import { soundCuesForLogs } from './sound-events';
import { app, persistSettings, resetSessionData } from './state.svelte';
import { playPhone, playSoundCue, playSoundCues } from './sounds';
import type { LogRow, StateResponse } from './types';
import { cloneRoutingConfig, DEFAULT_ROUTING_CONFIG, type RoutingConfig } from './routing';
import {
  broadcastLogDismissed,
  broadcastPollingLogs,
  broadcastPollingSnapshot,
  broadcastPollingState,
  isPollingLeader,
  requestPollingSnapshot,
  setPollingScope,
  startPollingSync,
  type PollingSnapshot,
} from './polling-sync';
import { uiSyncScope } from './ui-sync';

const STATE_INTERVAL = 3_000;
const LOG_INTERVAL = 2_000;
const HIDDEN_INTERVAL = 15_000;
const MAX_BACKOFF = 30_000;
const MAX_LOG_ROWS = 500;

let lastEventIds = new Set<number>();
let eventsInitialized = false;
let logsInitialized = false;
let logCursor = INITIAL_LOG_CURSOR;
let stateFailures = 0;
let logFailures = 0;
let stateTimer = 0;
let logTimer = 0;
let connectionTimer = 0;
let stateController: AbortController | null = null;
let logController: AbortController | null = null;
let generation = 0;
let started = false;
let lastState: StateResponse | null = null;
const dismissedLogIds = new Set<number>();

function resetCursors(): void {
  lastEventIds = new Set();
  eventsInitialized = false;
  logsInitialized = false;
  logCursor = INITIAL_LOG_CURSOR;
  stateFailures = 0;
  logFailures = 0;
  dismissedLogIds.clear();
}

function applyDismissedLogState(rows: LogRow[]): LogRow[] {
  return rows.map((row) => dismissedLogIds.has(row.id) ? { ...row, state: 'inactive' as const } : row);
}

function nextDelay(base: number, failures: number): number {
  if (document.hidden) return HIDDEN_INTERVAL;
  return Math.min(MAX_BACKOFF, base * Math.max(1, 2 ** failures));
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

function sessionIsWaiting(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase('en-US') : '';
  return message.includes('session not found') || message.includes('waiting for initial sync');
}

function scheduleConnectionRetry(): void {
  if (!isPollingLeader()) return;
  const scheduledGeneration = generation;
  clearTimeout(connectionTimer);
  connectionTimer = window.setTimeout(() => {
    if (scheduledGeneration !== generation || !app.sessionToken || app.stateHealthy) return;
    void connectCurrentSession();
  }, document.hidden ? HIDDEN_INTERVAL : STATE_INTERVAL);
}

function restartLoops(runImmediately: boolean): void {
  clearTimeout(stateTimer);
  clearTimeout(logTimer);
  clearTimeout(connectionTimer);
  if (!app.sessionToken || !isPollingLeader()) return;
  if (!app.stateHealthy) {
    if (runImmediately) void connectCurrentSession();
    else scheduleConnectionRetry();
    return;
  }
  if (runImmediately) {
    void refreshState().finally(() => scheduleState());
    void pollLogs().finally(() => scheduleLogs());
  } else {
    scheduleState();
    scheduleLogs();
  }
}

async function connectCurrentSession(): Promise<void> {
  if (!app.sessionToken || !isPollingLeader()) return;
  clearTimeout(connectionTimer);
  const requestGeneration = generation;
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
  if (requestGeneration !== generation) return;

  const logRequest = pollLogs().finally(() => {
    if (requestGeneration === generation) scheduleLogs();
  });
  await refreshState();
  if (requestGeneration === generation) scheduleState();
  void logRequest;
}

export async function switchSession(apiBase: string, token: string, pin: string): Promise<void> {
  generation += 1;
  stateController?.abort();
  logController?.abort();
  clearTimeout(stateTimer);
  clearTimeout(logTimer);
  clearTimeout(connectionTimer);
  app.sessionChanging = true;
  resetSessionData();
  resetCursors();
  app.apiBase = apiBase.trim() || '../backend/api.php';
  app.sessionToken = token.trim();
  app.pin = pin.trim();
  persistSettings();
  lastState = null;
  setPollingScope(uiSyncScope(app.apiBase, app.sessionToken));
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

async function applyState(data: StateResponse, playEventSounds: boolean, receivedAt = Date.now(), signal?: AbortSignal): Promise<void> {
  const applyGeneration = generation;
  app.mapBounds = data.session.map_bounds;
  app.players = data.players ?? [];
  app.vehicles = data.vehicles ?? [];
  app.events = data.events ?? [];
  app.assignments = data.assignments ?? [];
  app.hospitals = data.hospitals ?? [];
  app.hospitalReservations = data.hospital_reservations ?? [];
  app.clock = data.time ?? null;
  app.connected = true;
  app.stateHealthy = true;
  app.lastSuccessfulSync = receivedAt;
  app.lastError = '';
  stateFailures = 0;
  lastState = data;

  const newMod = data.session.mod_id ?? null;
  if (app.modId !== newMod) {
    if (app.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(app.mapImageUrl);
    app.modId = newMod;
    if (newMod) {
      try {
        const [mapImageUrl, routing] = await Promise.all([
          fetchMapImage(signal),
          apiGet<RoutingConfig>('routing_get', {}, { signal, requireFresh: false }),
        ]);
        if (signal?.aborted || applyGeneration !== generation) {
          if (mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(mapImageUrl);
          return;
        }
        app.mapImageUrl = mapImageUrl;
        app.routing = routing;
      } catch (error) {
        if (signal?.aborted || applyGeneration !== generation) return;
        app.mapImageUrl = '';
        app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
        app.lastError = `Kartendaten: ${(error as Error).message}`;
      }
    } else {
      app.mapImageUrl = '';
      app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
    }
  }

  const ids = new Set(app.events.map((event) => event.id));
  if (playEventSounds && eventsInitialized) {
    const fresh = app.events.some((event) => !lastEventIds.has(event.id) && event.created_by === 'game');
    if (fresh) void playPhone();
    if ([...lastEventIds].some((id) => !ids.has(id))) void playSoundCue('incident-completed');
  }
  eventsInitialized = true;
  lastEventIds = ids;

  if (app.highlightedEventId != null && !ids.has(app.highlightedEventId)) app.highlightedEventId = null;
}

export async function refreshState(): Promise<void> {
  if (!app.sessionToken) return;
  stateController?.abort();
  const controller = new AbortController();
  stateController = controller;
  const requestGeneration = generation;
  try {
    const data = await apiGet<StateResponse>('state', {}, { signal: controller.signal });
    if (requestGeneration !== generation) return;
    const receivedAt = Date.now();
    await applyState(data, isPollingLeader(), receivedAt, controller.signal);
    if (requestGeneration !== generation) return;
    broadcastPollingState(data, receivedAt);
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
  try {
    for (let page = 0; page < 5; page += 1) {
      const data = await apiGet<{ logs: LogRow[] }>(
        'logs',
        { since: logCursor.timestamp, since_id: logCursor.id },
        { signal: controller.signal }
      );
      if (requestGeneration !== generation) return;
      const rows = data.logs ?? [];
      if (!rows.length) break;
      const applicableRows = applyDismissedLogState(rows);
      const activeRows = applicableRows.filter((row) => !dismissedLogIds.has(row.id));
      app.logs = mergeLogRows(app.logs, applicableRows, MAX_LOG_ROWS);
      incomingIds.push(...activeRows.map((row) => row.id));
      incomingRows.push(...activeRows);
      broadcastRows.push(...applicableRows);
      logCursor = advanceLogCursor(logCursor, rows);
      if (rows.length < 100) break;
    }
    app.logsHealthy = true;
    const receivedAt = Date.now();
    app.lastSuccessfulLogPoll = receivedAt;
    app.logError = '';
    logFailures = 0;
    if (logsInitialized && incomingIds.length) {
      app.lastLogBatch = incomingIds;
      void playSoundCues(soundCuesForLogs(incomingRows));
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

export async function dismissLog(id: number): Promise<void> {
  await api('log_viewed', { mid: id }, { requireFresh: true });
  markLogDismissed(id);
  broadcastLogDismissed(id);
}

function markLogDismissed(id: number): void {
  dismissedLogIds.add(id);
  app.logs = app.logs.map((row) => (row.id === id ? { ...row, state: 'inactive' as const } : row));
  app.lastLogBatch = app.lastLogBatch.filter((item) => item !== id);
}

export function startPolling(): void {
  if (started) return;
  started = true;
  startPollingSync({
    onLeaderChange: (leader) => {
      stateController?.abort();
      logController?.abort();
      clearTimeout(stateTimer);
      clearTimeout(logTimer);
      clearTimeout(connectionTimer);
      if (leader) restartLoops(true);
    },
    onState: (state, receivedAt) => { void applyState(state, false, receivedAt); },
    onLogs: (rows, cursor, receivedAt) => {
      app.logs = mergeLogRows(app.logs, applyDismissedLogState(rows), MAX_LOG_ROWS);
      logCursor = cursor;
      app.logsHealthy = true;
      app.lastSuccessfulLogPoll = receivedAt;
      app.logError = '';
      logsInitialized = true;
    },
    onLogDismissed: markLogDismissed,
    onSnapshot: (snapshot) => { void applyPollingSnapshot(snapshot); },
    snapshot: pollingSnapshot,
  });
  setPollingScope(uiSyncScope(app.apiBase, app.sessionToken));
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
