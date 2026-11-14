import { app } from './state.svelte';

// Betreiberansicht: Tagesaggregate aus anonymous_metrics und das Adapter-Log,
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

export async function fetchMetricsSummary(key: string): Promise<MetricsSummary> {
  const res = await fetch(`${app.apiBase}?action=metrics_summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_key: key }),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as { error?: string; enabled?: boolean; days_back?: number; days?: MetricsDay[] } | null;
  if (!res.ok) {
    const message = data?.error ?? `Serverfehler ${res.status}`;
    throw res.status === 403 ? new OperatorKeyError(message) : new Error(message);
  }
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
  const res = await fetch(`${app.apiBase}?action=session_log_list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator_key: key }),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as { error?: string; entries?: SessionLogEntry[]; limit?: number } | null;
  if (!res.ok) {
    const message = data?.error ?? `Serverfehler ${res.status}`;
    throw res.status === 403 ? new OperatorKeyError(message) : new Error(message);
  }
  return { entries: Array.isArray(data?.entries) ? data.entries : [], limit: Number(data?.limit ?? 0) };
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
