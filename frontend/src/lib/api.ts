import { app, canWrite } from './state.svelte';

const WRITE_ACTIONS = new Set([
  'events_create',
  'events_finish',
  'events_assign',
  'events_reassign',
  'events_unassign',
  'events_set_leader',
  'events_set_note',
  'events_add_feedback',
  'vehicles_assign_player',
  'vehicles_alarm',
  'update_vehicles',
  'log_viewed',
  'hospital_reservation_set',
  'hospital_reservation_clear',
  'session_monitor_hospital_capacity_set',
  'routing_put',
]);

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requireFresh?: boolean;
}

interface SessionResolution {
  session_id: string;
  session_token: string;
  bridge: { protocol_version?: number };
}

export function deriveV2Base(apiBase: string): string {
  const url = new URL(apiBase, location.href);
  if (url.pathname.endsWith('/backend/api.php')) url.pathname = url.pathname.slice(0, -'/backend/api.php'.length) + '/api/v2';
  else if (!url.pathname.endsWith('/api/v2')) url.pathname = url.pathname.replace(/\/$/, '') + '/api/v2';
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export async function resolveSessionApi(options: RequestOptions = {}): Promise<void> {
  app.apiMode = 'legacy';
  app.sessionId = '';
  app.apiV2Base = new URLSearchParams(location.search).get('api_v2_base')?.replace(/\/$/, '') || deriveV2Base(app.apiBase);
  if (!app.sessionToken) return;
  const controlled = requestSignal(options.signal, options.timeoutMs ?? 4_000);
  try {
    const response = await fetch(`${app.apiV2Base}/sessions/resolve/${encodeURIComponent(app.sessionToken)}`, {
      cache: 'no-store',
      signal: controlled.signal,
    });
    if (!response.ok) return;
    const resolution = await parseResponse<SessionResolution>(response);
    if (Number(resolution.bridge?.protocol_version ?? 0) < 2 || !resolution.session_id) return;
    app.apiMode = 'v2';
    app.sessionId = resolution.session_id;
  } catch {
    // Ein alter Server kennt die Erkennung nicht; solche Sitzungen laufen weiter über die Legacy-API.
  } finally {
    controlled.cleanup();
  }
}

function requestSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('Zeitüberschreitung', 'TimeoutError')),
    timeoutMs,
  );
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
    },
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`Serverfehler ${res.status}`);
      throw new Error('Der Server hat keine gültige JSON-Antwort geliefert');
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String(data.error)
        : `Anfrage fehlgeschlagen (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

function readableNetworkError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError') return new Error('Anfrage abgebrochen');
  if (error instanceof DOMException && error.name === 'TimeoutError') return new Error('Der Server antwortet nicht');
  if (error instanceof TypeError) return new Error('Server nicht erreichbar');
  return error instanceof Error ? error : new Error('Anfrage fehlgeschlagen');
}

export async function api<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
  options: RequestOptions = {},
): Promise<T> {
  if ((options.requireFresh ?? WRITE_ACTIONS.has(action)) && !canWrite()) {
    throw new Error('Die Datenverbindung ist veraltet. Aktion nicht gesendet.');
  }
  if (app.apiMode === 'v2') return v2Request<T>(action, payload, options);
  const url = `${app.apiBase}?action=${encodeURIComponent(action)}`;
  const body: Record<string, unknown> = { ...payload, session_token: app.sessionToken };
  if (app.pin) body.pin = app.pin;
  const controlled = requestSignal(options.signal, options.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controlled.signal,
    });
    return await parseResponse<T>(res);
  } catch (error) {
    throw readableNetworkError(error);
  } finally {
    controlled.cleanup();
  }
}

export async function apiGet<T = unknown>(
  action: string,
  params: Record<string, string | number> = {},
  options: RequestOptions = {},
): Promise<T> {
  if ((options.requireFresh ?? WRITE_ACTIONS.has(action)) && !canWrite()) {
    throw new Error('Die Datenverbindung ist veraltet. Aktion nicht gesendet.');
  }
  if (app.apiMode === 'v2') return v2Request<T>(action, params, options);
  const body = { ...params, session_token: app.sessionToken };
  const controlled = requestSignal(options.signal, options.timeoutMs ?? 10_000);
  try {
    const res = await fetch(`${app.apiBase}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controlled.signal,
    });
    return await parseResponse<T>(res);
  } catch (error) {
    throw readableNetworkError(error);
  } finally {
    controlled.cleanup();
  }
}

export async function fetchMapImage(
  modId?: string | null,
  version?: string | null,
  signal?: AbortSignal,
): Promise<string> {
  if (app.apiMode === 'v2' && modId) {
    const url = new URL(`${app.apiV2Base}/mods/${encodeURIComponent(modId)}/map`);
    if (version) url.searchParams.set('v', version);
    return url.href;
  }
  if (modId && version) {
    const url = new URL(app.apiBase, location.href);
    url.search = new URLSearchParams({ action: 'map_asset', mod_id: modId, v: version }).toString();
    return url.href;
  }
  const controlled = requestSignal(signal, 15_000);
  try {
    const res = await fetch(`${app.apiBase}?action=map_image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: app.sessionToken }),
      cache: 'no-store',
      signal: controlled.signal,
    });
    if (!res.ok) throw new Error((await res.text()) || `Kartenbild nicht verfügbar (${res.status})`);
    return URL.createObjectURL(await res.blob());
  } catch (error) {
    throw readableNetworkError(error);
  } finally {
    controlled.cleanup();
  }
}

function v2Route(action: string, payload: Record<string, unknown>): { method: string; path: string; query?: Record<string, unknown>; body?: Record<string, unknown> } {
  const session = `/sessions/${encodeURIComponent(app.sessionId)}`;
  const eventId = Number(payload.event_id ?? 0);
  const vehicleId = Number(payload.vehicle_id ?? 0);
  const mid = Number(payload.mid ?? 0);
  switch (action) {
    case 'session_validate': return { method: 'GET', path: session };
    case 'state': return { method: 'GET', path: `${session}/state`, query: { profile: 'control', knownRevision: payload.known_revision } };
    case 'monitor_state': return { method: 'GET', path: `${session}/state`, query: { profile: 'monitor', knownRevision: payload.known_revision } };
    case 'logs': return { method: 'GET', path: `${session}/logs`, query: { since: payload.since, sinceId: payload.since_id } };
    case 'status_history': return { method: 'GET', path: `${session}/status-history` };
    case 'session_statistics': return { method: 'GET', path: `${session}/statistics` };
    case 'routing_get': return { method: 'GET', path: `${session}/routing` };
    case 'events_archive': return { method: 'GET', path: `${session}/events`, query: { view: 'archive' } };
    case 'event_record': return { method: 'GET', path: `${session}/events/${eventId}/record` };
    case 'events_get_vehicles': return { method: 'GET', path: `${session}/events/${eventId}/vehicles` };
    case 'events_get_logs': return { method: 'GET', path: `${session}/events/${eventId}/logs` };
    case 'events_get_feedback': return { method: 'GET', path: `${session}/events/${eventId}/feedback` };
    case 'events_create': return { method: 'POST', path: `${session}/events`, body: payload };
    case 'events_finish': return { method: 'POST', path: `${session}/events/${eventId}/finish` };
    case 'events_assign': return { method: 'POST', path: `${session}/events/${eventId}/assignments`, body: payload };
    case 'events_unassign': return { method: 'DELETE', path: `${session}/assignments`, body: payload };
    case 'events_reassign': return { method: 'PATCH', path: `${session}/assignments/${vehicleId}`, body: payload };
    case 'events_set_leader': return { method: 'PUT', path: `${session}/events/${eventId}/leaders/${encodeURIComponent(String(payload.role ?? 'fire'))}`, body: payload };
    case 'events_add_feedback': return { method: 'POST', path: `${session}/events/${eventId}/feedback`, body: payload };
    case 'events_set_note': return { method: 'PUT', path: `${session}/events/${eventId}/note`, body: payload };
    case 'vehicles_alarm': return { method: 'POST', path: `${session}/vehicles/${vehicleId}/alarm`, body: payload };
    case 'vehicles_assign_player': return { method: 'PUT', path: `${session}/vehicles/${vehicleId}/player`, body: payload };
    case 'hospital_reservation_set': return { method: 'PUT', path: `${session}/hospital-reservations/${vehicleId}`, body: payload };
    case 'hospital_reservation_clear': return { method: 'DELETE', path: `${session}/hospital-reservations/${vehicleId}` };
    case 'session_monitor_hospital_capacity_set': return { method: 'PUT', path: `${session}/settings/monitor-hospital-capacity`, body: payload };
    case 'routing_put': return { method: 'PUT', path: `${session}/routing`, body: payload };
    case 'log_viewed': return { method: 'POST', path: `${session}/logs/${mid}/view` };
    case 'log_acknowledge': return { method: 'POST', path: `${session}/logs/${mid}/acknowledge` };
    default: throw new Error(`Aktion ${action} ist in API v2 noch nicht verfügbar.`);
  }
}

async function v2Request<T>(action: string, payload: Record<string, unknown>, options: RequestOptions): Promise<T> {
  if (!app.sessionId) throw new Error('API-v2-Sitzung ist nicht aufgelöst.');
  const route = v2Route(action, payload);
  const url = new URL(app.apiV2Base + route.path);
  for (const [key, value] of Object.entries(route.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Session-Code': app.sessionToken };
  if (app.pin) headers['X-Session-Pin'] = app.pin;
  if (route.body) headers['Content-Type'] = 'application/json';
  const controlled = requestSignal(options.signal, options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      method: route.method,
      headers,
      body: route.body ? JSON.stringify(route.body) : undefined,
      cache: 'no-store',
      signal: controlled.signal,
    });
    return await parseResponse<T>(response);
  } catch (error) {
    throw readableNetworkError(error);
  } finally {
    controlled.cleanup();
  }
}
