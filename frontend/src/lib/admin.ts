import { app } from './state.svelte';

// Zentrale unter /admin/: Messwerte, Adapter-Log, Mods und Sitzungen, alles
// geschützt über OPERATOR_KEY. Der Schlüssel bleibt im sessionStorage des Tabs.

export const OPERATOR_KEY_STORAGE = 'operatorKey';

export const METRIC_LABELS = {
  events_created: 'Angelegte Einsätze',
  active_events: 'Sichtbare Einsätze',
  state_load_ms: 'Ladezeit des Zustands',
} as const;

export type MetricName = keyof typeof METRIC_LABELS;

export interface MetricAggregate {
  count: number;
  sum: number;
  average: number;
  max: number;
}

export interface MetricsDay {
  day: string;
  metrics: Partial<Record<MetricName, MetricAggregate>>;
}

export interface MetricsSummary {
  enabled: boolean;
  daysBack: number;
  days: MetricsDay[];
}

export class OperatorKeyError extends Error {}

export function loadOperatorKey(): string {
  try {
    return sessionStorage.getItem(OPERATOR_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveOperatorKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(OPERATOR_KEY_STORAGE, key);
    else sessionStorage.removeItem(OPERATOR_KEY_STORAGE);
  } catch {
    // Ohne Speicher fragt die Seite den Schlüssel beim nächsten Laden erneut ab.
  }
}

export async function operatorPost<T>(action: string, key: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${app.apiBase}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_key: key, ...body }),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    const message = data?.error ?? `Serverfehler ${res.status}`;
    throw res.status === 403 ? new OperatorKeyError(message) : new Error(message);
  }
  return (data ?? {}) as T;
}

export async function fetchMetricsSummary(key: string): Promise<MetricsSummary> {
  const data = await operatorPost<{ enabled?: boolean; days_back?: number; days?: MetricsDay[] }>('metrics_summary', key);
  return {
    enabled: Boolean(data?.enabled),
    daysBack: Number(data?.days_back ?? 30),
    days: Array.isArray(data?.days) ? data.days : [],
  };
}

// Adapter-Log der letzten 24 Stunden aus session_log, gleicher Schlüssel.
export const LOG_LEVEL_LABELS = { info: 'Info', good: 'OK', warn: 'Warnung', bad: 'Fehler' } as const;

export type LogLevel = keyof typeof LOG_LEVEL_LABELS;

export interface SessionLogEntry {
  id: number;
  session_id: number;
  created_at: string;
  level: LogLevel;
  text: string;
}

export interface SessionLogGroup {
  sessionId: number;
  entries: SessionLogEntry[];
  problems: number;
}

export async function fetchSessionLog(key: string): Promise<{ entries: SessionLogEntry[]; limit: number }> {
  const data = await operatorPost<{ entries?: SessionLogEntry[]; limit?: number }>('session_log_list', key);
  return { entries: Array.isArray(data.entries) ? data.entries : [], limit: Number(data.limit ?? 0) };
}

// Neueste Sitzung zuerst, Einträge darin in zeitlicher Folge. Sitzungen ohne
// Treffer für das gewählte Level fallen weg.
export function groupSessionLog(entries: SessionLogEntry[], level: LogLevel | ''): SessionLogGroup[] {
  const groups = new Map<number, SessionLogGroup>();
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (level && entry.level !== level) continue;
    let group = groups.get(entry.session_id);
    if (!group) groups.set(entry.session_id, (group = { sessionId: entry.session_id, entries: [], problems: 0 }));
    group.entries.push(entry);
    if (entry.level === 'warn' || entry.level === 'bad') group.problems++;
  }
  return [...groups.values()].sort((a, b) => b.entries[b.entries.length - 1].id - a.entries[a.entries.length - 1].id);
}

// 2026-11-14 09:05:03 -> 14.11. 09:05:03
export function formatLogTime(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value);
  return match ? `${match[2]}.${match[1]}. ${match[3]}` : value;
}

// Werte in Tagesreihenfolge (alt nach neu) für die Balken; fehlende Tage zählen 0.
export function metricSeries(days: MetricsDay[], name: MetricName, field: 'sum' | 'average' | 'max'): { day: string; value: number }[] {
  return [...days]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({ day: entry.day, value: entry.metrics[name]?.[field] ?? 0 }));
}

export function formatMetric(name: MetricName, value: number | undefined): string {
  if (value === undefined) return '–';
  if (name === 'state_load_ms') return `${Math.round(value)} ms`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// 2026-09-05 -> 05.09.
export function formatDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return match ? `${match[3]}.${match[2]}.` : day;
}

// Mods: eine Zeile je Eintrag in der mods-Tabelle. Sitzungen legen fehlende
// Mods beim Verbinden selbst an, Name und Kartenbild kommen aus der Zentrale.
export type ModAssetSource = 'file' | 'database' | 'none';

export interface AdminMod {
  mod_id: string;
  name: string | null;
  sessions: number;
  updated_at: string;
  meters_per_world_unit: number;
  map_source: ModAssetSource;
  map_file: string | null;
  map_image_bytes: number;
  map_mime_type: string | null;
  routing_source: ModAssetSource;
  routing_nodes: number;
  routing_edges: number;
  routing_bma_zones: number;
}

export const MOD_ASSET_SOURCE_LABELS: Record<ModAssetSource, string> = {
  file: 'Datei',
  database: 'Datenbank',
  none: 'fehlt',
};

export const MOD_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MOD_IMAGE_MAX_BYTES = 16 * 1024 * 1024;

export async function fetchMods(key: string): Promise<AdminMod[]> {
  const data = await operatorPost<{ mods?: AdminMod[] }>('admin_mods', key);
  return Array.isArray(data.mods) ? data.mods : [];
}

export async function saveMod(
  key: string,
  mod: { mod_id: string; name: string; image?: { base64: string; mime: string } | null },
): Promise<void> {
  await operatorPost('mods_put', key, {
    mod_id: mod.mod_id,
    name: mod.name,
    ...(mod.image ? { image_base64: mod.image.base64, mime_type: mod.image.mime } : {}),
  });
}

export function readImageFile(file: File): Promise<{ base64: string; mime: string }> {
  if (!MOD_IMAGE_MIME_TYPES.includes(file.type)) {
    return Promise.reject(new Error('Erlaubt sind JPEG, PNG und WebP.'));
  }
  if (file.size > MOD_IMAGE_MAX_BYTES) {
    return Promise.reject(new Error(`Das Kartenbild ist größer als ${MOD_IMAGE_MAX_BYTES / 1024 / 1024} MB.`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Das Kartenbild ließ sich nicht lesen.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve({ base64: comma === -1 ? result : result.slice(comma + 1), mime: file.type });
    };
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '–';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Der Routing-Editor liegt auf der Hauptseite und läuft nur lokal gegen die
// Dateien in backend/maps.
export function routingEditorUrl(modId: string): string {
  return `../?routing_editor=1&mod_id=${encodeURIComponent(modId)}`;
}

export interface AdminSession {
  id: number;
  token: string;
  mod_id: string | null;
  has_pin: boolean;
  created_at: string;
  last_activity_at: string;
  players: number;
  vehicles: number;
  open_events: number;
}

export interface AdminSessions {
  sessions: AdminSession[];
  limit: number;
  ttlSeconds: number;
}

export async function fetchSessions(key: string): Promise<AdminSessions> {
  const data = await operatorPost<{ sessions?: AdminSession[]; limit?: number; ttl_seconds?: number }>('admin_sessions', key);
  return {
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    limit: Number(data.limit ?? 0),
    ttlSeconds: Number(data.ttl_seconds ?? 0),
  };
}

export async function deleteSession(key: string, sessionId: number): Promise<void> {
  await operatorPost('admin_session_delete', key, { session_id: sessionId });
}

// Eine Sitzung gilt als still, sobald der Server sie beim nächsten Aufräumen
// löschen würde.
export function sessionIsStale(session: AdminSession, ttlSeconds: number, now = Date.now()): boolean {
  const activity = Date.parse(session.last_activity_at.replace(' ', 'T'));
  return Number.isFinite(activity) && now - activity > ttlSeconds * 1000;
}
