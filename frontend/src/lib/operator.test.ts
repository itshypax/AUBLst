import { describe, expect, it } from 'vitest';
import { formatDay, formatMetric, metricSeries, type MetricsDay } from './operator';

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
});
