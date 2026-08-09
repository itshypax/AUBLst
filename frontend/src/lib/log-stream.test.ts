import { describe, expect, it } from 'vitest';
import { advanceLogCursor, INITIAL_LOG_CURSOR, mergeLogRows } from './log-stream';
import type { LogRow } from './types';

function row(id: number, updatedAt: string): LogRow {
  return {
    id,
    type: 'vehicle',
    entity_id: `vehicle-${id}`,
    event_id: null,
    message: 'S1',
    long_message: `Meldung ${id}`,
    state: 'active',
    updated_at: updatedAt,
  };
}

describe('Funk-Cursor', () => {
  it('merkt sich bei gleichem Zeitstempel zusätzlich die letzte ID', () => {
    const timestamp = '2026-08-09 14:35:00';
    expect(advanceLogCursor(INITIAL_LOG_CURSOR, [row(10, timestamp), row(11, timestamp)])).toEqual({
      timestamp,
      id: 11,
    });
  });

  it('sortiert gleiche Zeitstempel nach ID und begrenzt den Verlauf', () => {
    const timestamp = '2026-08-09 14:35:00';
    const merged = mergeLogRows([row(3, timestamp)], [row(2, timestamp), row(4, timestamp)], 2);
    expect(merged.map((item) => item.id)).toEqual([3, 4]);
  });
});
