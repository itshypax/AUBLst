import { describe, expect, it } from 'vitest';
import { formatDay, formatLogTime, formatMetric, groupSessionLog, metricSeries, type MetricsDay, type SessionLogEntry } from './operator';

const days: MetricsDay[] = [
  { day: '2026-09-05', metrics: { active_events: { count: 4, sum: 10, average: 2.5, max: 5 } } },
  { day: '2026-09-03', metrics: { active_events: { count: 1, sum: 1, average: 1, max: 1 }, state_load_ms: { count: 2, sum: 300, average: 150, max: 200 } } },
];

describe('Betreiber-Kennzahlen', () => {
  it('sortiert die Balkenreihe aufsteigend und setzt fehlende Werte auf 0', () => {
    expect(metricSeries(days, 'active_events', 'max')).toEqual([
      { day: '2026-09-03', value: 1 },
      { day: '2026-09-05', value: 5 },
    ]);
    expect(metricSeries(days, 'state_load_ms', 'average')).toEqual([
      { day: '2026-09-03', value: 150 },
      { day: '2026-09-05', value: 0 },
    ]);
  });

  it('formatiert Ladezeiten in Millisekunden und Zählwerte ohne Nachkommastellen', () => {
    expect(formatMetric('state_load_ms', 119.6)).toBe('120 ms');
    expect(formatMetric('active_events', 2.5)).toBe('2.5');
    expect(formatMetric('events_created', 3)).toBe('3');
    expect(formatMetric('events_created', undefined)).toBe('–');
    expect(formatDay('2026-09-05')).toBe('05.09.');
  });

  it('gruppiert das Adapter-Log je Sitzung, neueste Sitzung zuerst, und filtert nach Level', () => {
    const entries: SessionLogEntry[] = [
      { id: 4, session_id: 2, created_at: '2026-11-14 10:00:02', level: 'bad', text: 'Server antwortet nicht' },
      { id: 1, session_id: 1, created_at: '2026-11-14 09:00:00', level: 'good', text: 'Code erhalten' },
      { id: 3, session_id: 2, created_at: '2026-11-14 10:00:00', level: 'good', text: 'Code erhalten' },
      { id: 2, session_id: 1, created_at: '2026-11-14 09:00:05', level: 'warn', text: 'Befehl nicht verstanden' },
    ];
    const all = groupSessionLog(entries, '');
    expect(all.map((group) => group.sessionId)).toEqual([2, 1]);
    expect(all[1].entries.map((entry) => entry.id)).toEqual([1, 2]);
    expect(all.map((group) => group.problems)).toEqual([1, 1]);
    expect(groupSessionLog(entries, 'warn').map((group) => group.sessionId)).toEqual([1]);
    expect(formatLogTime('2026-11-14 09:05:03')).toBe('14.11. 09:05:03');
  });
});
