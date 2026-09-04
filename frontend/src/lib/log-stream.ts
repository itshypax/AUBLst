import type { LogRow } from './types';

export interface LogCursor {
  timestamp: string;
  id: number;
}

// Weit über dem TIMESTAMP-Minimum, weil der Server den Wert in der
// Verbindungszeitzone vergleicht (siehe backend/src/actions/logs.php).
export const INITIAL_LOG_CURSOR: LogCursor = { timestamp: '2000-01-01 00:00:00', id: 0 };

export function advanceLogCursor(cursor: LogCursor, rows: LogRow[]): LogCursor {
  const last = rows[rows.length - 1];
  return last ? { timestamp: last.updated_at, id: last.id } : cursor;
}

export function mergeLogRows(existing: LogRow[], incoming: LogRow[], limit: number): LogRow[] {
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()]
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id - b.id)
    .slice(-limit);
}
