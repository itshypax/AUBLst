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
  'vehicles_set_unavailable',
  'update_vehicles',
  'log_viewed',
  'hospital_reservation_set',
  'hospital_reservation_clear',
  'session_monitor_hospital_capacity_set',
  'routing_put',
  'layouts_put',
  'layouts_delete',
]);

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requireFresh?: boolean;
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
