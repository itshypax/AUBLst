import { api, apiGet, fetchMapImage } from './api';
import { advanceLogCursor, INITIAL_LOG_CURSOR, mergeLogRows } from './log-stream';
import { isSpeechRequest } from './speech-requests';
import { app, persistSettings, resetSessionData } from './state.svelte';
import { playAlarm, playPhone, playSpeechRequest } from './sounds';
import type { LogRow, StateResponse } from './types';
import { cloneRoutingConfig, DEFAULT_ROUTING_CONFIG, type RoutingConfig } from './routing';

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
let stateController: AbortController | null = null;
let logController: AbortController | null = null;
let generation = 0;
let started = false;

function resetCursors(): void {
  lastEventIds = new Set();
  eventsInitialized = false;
  logsInitialized = false;
  logCursor = INITIAL_LOG_CURSOR;
  stateFailures = 0;
  logFailures = 0;
}

function nextDelay(base: number, failures: number): number {
  if (document.hidden) return HIDDEN_INTERVAL;
  return Math.min(MAX_BACKOFF, base * Math.max(1, 2 ** failures));
}

function scheduleState(delay = nextDelay(STATE_INTERVAL, stateFailures)): void {
  const scheduledGeneration = generation;
  clearTimeout(stateTimer);
  stateTimer = window.setTimeout(async () => {
    if (scheduledGeneration !== generation) return;
    await refreshState();
    if (scheduledGeneration === generation) scheduleState();
  }, delay);
}

function scheduleLogs(delay = nextDelay(LOG_INTERVAL, logFailures)): void {
  const scheduledGeneration = generation;
  clearTimeout(logTimer);
  logTimer = window.setTimeout(async () => {
    if (scheduledGeneration !== generation) return;
    await pollLogs();
    if (scheduledGeneration === generation) scheduleLogs();
  }, delay);
}

function restartLoops(runImmediately: boolean): void {
  clearTimeout(stateTimer);
  clearTimeout(logTimer);
  if (!app.sessionToken) return;
  if (runImmediately) {
    void refreshState().finally(() => scheduleState());
    void pollLogs().finally(() => scheduleLogs());
  } else {
    scheduleState();
    scheduleLogs();
  }
}

async function connectCurrentSession(): Promise<void> {
  if (!app.sessionToken) return;
  const requestGeneration = generation;
  try {
    await api('session_validate', {}, { requireFresh: false });
  } catch (error) {
    if (requestGeneration !== generation) return;
    app.connected = false;
    app.stateHealthy = false;
    app.logsHealthy = false;
    app.lastError = (error as Error).message;
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
  app.sessionChanging = true;
  resetSessionData();
  resetCursors();
  app.apiBase = apiBase.trim() || '../backend/api.php';
  app.sessionToken = token.trim();
  app.pin = pin.trim();
  persistSettings();
  try {
    if (started && app.sessionToken) {
      await connectCurrentSession();
    }
  } finally {
    app.sessionChanging = false;
  }
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
    app.lastSuccessfulSync = Date.now();
    app.lastError = '';
    stateFailures = 0;

    const newMod = data.session.mod_id ?? null;
    if (app.modId !== newMod) {
      if (app.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(app.mapImageUrl);
      app.modId = newMod;
      if (newMod) {
        try {
          const [mapImageUrl, routing] = await Promise.all([
            fetchMapImage(controller.signal),
            apiGet<RoutingConfig>('routing_get', {}, { signal: controller.signal, requireFresh: false }),
          ]);
          app.mapImageUrl = mapImageUrl;
          app.routing = routing;
        } catch (error) {
          if (controller.signal.aborted) return;
          app.mapImageUrl = '';
          app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
          app.lastError = `Kartendaten: ${(error as Error).message}`;
        }
      } else {
        app.mapImageUrl = '';
        app.routing = cloneRoutingConfig(DEFAULT_ROUTING_CONFIG);
      }
      if (requestGeneration !== generation) {
        if (app.mapImageUrl.startsWith('blob:')) URL.revokeObjectURL(app.mapImageUrl);
        return;
      }
    }

    const ids = new Set(app.events.map((event) => event.id));
    if (eventsInitialized) {
      const fresh = app.events.some((event) => !lastEventIds.has(event.id) && event.created_by === 'game');
      if (fresh) void playPhone();
    }
    eventsInitialized = true;
    lastEventIds = ids;

    if (app.highlightedEventId != null && !ids.has(app.highlightedEventId)) app.highlightedEventId = null;
  } catch (error) {
    if (controller.signal.aborted || requestGeneration !== generation) return;
    stateFailures += 1;
    app.connected = false;
    app.stateHealthy = false;
    app.lastError = (error as Error).message;
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
      app.logs = mergeLogRows(app.logs, rows, MAX_LOG_ROWS);
      incomingIds.push(...rows.map((row) => row.id));
      incomingRows.push(...rows);
      logCursor = advanceLogCursor(logCursor, rows);
      if (rows.length < 100) break;
    }
    app.logsHealthy = true;
    app.lastSuccessfulLogPoll = Date.now();
    app.logError = '';
    logFailures = 0;
    if (logsInitialized && incomingIds.length) {
      app.lastLogBatch = incomingIds;
      if (incomingRows.some(isSpeechRequest)) void playSpeechRequest();
      else void playAlarm();
    } else {
      app.lastLogBatch = [];
    }
    logsInitialized = true;
  } catch (error) {
    if (controller.signal.aborted || requestGeneration !== generation) return;
    logFailures += 1;
    app.logsHealthy = false;
    app.logError = (error as Error).message;
  } finally {
    if (logController === controller) logController = null;
  }
}

export async function dismissLog(id: number): Promise<void> {
  await api('log_viewed', { mid: id }, { requireFresh: true });
  app.logs = app.logs.map((row) => (row.id === id ? { ...row, state: 'inactive' as const } : row));
  app.lastLogBatch = app.lastLogBatch.filter((item) => item !== id);
}

export function startPolling(): void {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => restartLoops(!document.hidden));
  if (app.sessionToken) {
    app.sessionChanging = true;
    void connectCurrentSession().finally(() => (app.sessionChanging = false));
  }
}
