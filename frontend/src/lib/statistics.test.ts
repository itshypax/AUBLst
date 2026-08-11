import { describe, expect, it } from 'vitest';
import type { SessionStatisticsResponse } from './types';
import { buildSessionStatistics, formatStatisticDuration } from './statistics';

describe('Session-Statistik', () => {
  it('fasst Einsätze und Alarmierungen für die Übersicht zusammen', () => {
    const data: SessionStatisticsResponse = {
      session: {
        token: '4669',
        created_at: '2026-08-09 12:00:00',
        generated_at: '2026-08-09 16:00:00',
      },
      events: [
        { id: 1, name: 'Wohnungsbrand', status: 'completed', created_by: 'game', created_at: '2026-08-09 12:00:00', updated_at: '2026-08-09 13:00:00' },
        { id: 2, name: 'Verkehrsunfall', status: 'active', created_by: 'game', created_at: '2026-08-09 13:00:00', updated_at: '2026-08-09 13:00:00' },
        { id: 3, name: 'Bewusstlose Person', status: 'completed', created_by: 'game', created_at: '2026-08-09 14:00:00', updated_at: '2026-08-09 14:30:00' },
        { id: 4, name: 'Unklare Lage', status: 'canceled', created_by: 'frontend', created_at: '2026-08-09 15:00:00', updated_at: '2026-08-09 15:10:00' },
        { id: 5, name: 'Gewässerverunreinigung', status: 'active', created_by: 'game', created_at: '2026-08-09 15:30:00', updated_at: '2026-08-09 15:30:00' },
      ],
      dispatches: [
        { event_id: 1, game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', mode: 'Sondersignal', created_at: '2026-08-09 12:05:00' },
        { event_id: 2, game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', mode: 'Sondersignal', created_at: '2026-08-09 13:05:00' },
        { event_id: 3, game_vehicle_id: '72_RTW_1', vehicle_name: '72-RTW-1', mode: null, created_at: '2026-08-09 14:05:00' },
      ],
      status_history: [
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 2, created_at: '2026-08-09 12:00:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 3, created_at: '2026-08-09 12:05:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 5, created_at: '2026-08-09 12:15:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 4, created_at: '2026-08-09 12:20:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 1, created_at: '2026-08-09 13:00:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 6, created_at: '2026-08-09 14:00:00' },
        { game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 2, created_at: '2026-08-09 14:30:00' },
      ],
      log_count: 17,
    };

    const model = buildSessionStatistics(data);

    expect(model.eventCount).toBe(5);
    expect(model.completedCount).toBe(2);
    expect(model.dispatchCount).toBe(3);
    expect(model.logCount).toBe(17);
    expect(model.categories.map((item) => [item.key, item.value])).toEqual([
      ['fire', 1],
      ['hazard', 0],
      ['water', 1],
      ['thl', 1],
      ['medical', 1],
      ['other', 1],
    ]);
    expect(model.vehicles[0]).toMatchObject({ label: '1-HLF-1', value: 2 });
    expect(model.timeline.reduce((sum, item) => sum + item.value, 0)).toBe(5);
    expect(model.peakCount).toBeGreaterThan(0);
    expect(model.vehicleUtilization[0]).toMatchObject({ label: '1-HLF-1', value: 23, unavailable: 13 });
    expect(formatStatisticDuration(model.averageEventDurationMs)).toBe('45 Min.');
  });

  it('teilt kurze Sitzungen in mehrere Zeitfenster auf', () => {
    const data: SessionStatisticsResponse = {
      session: { token: 'kurz', created_at: '2026-08-09 20:17:00', generated_at: '2026-08-09 20:47:00' },
      events: [
        { id: 1, name: 'Brand', status: 'completed', created_by: 'game', created_at: '2026-08-09 20:18:00', updated_at: '2026-08-09 20:20:00' },
        { id: 2, name: 'Ölspur', status: 'completed', created_by: 'game', created_at: '2026-08-09 20:29:00', updated_at: '2026-08-09 20:35:00' },
        { id: 3, name: 'Person gestürzt', status: 'active', created_by: 'game', created_at: '2026-08-09 20:43:00', updated_at: '2026-08-09 20:43:00' },
      ],
      dispatches: [],
      status_history: [],
      log_count: 0,
    };

    const model = buildSessionStatistics(data);

    expect(model.timeline).toHaveLength(6);
    expect(model.timeline.map((item) => item.label)).toEqual(['20:17', '20:22', '20:27', '20:32', '20:37', '20:42']);
    expect(model.timeline.map((item) => item.value)).toEqual([1, 0, 1, 0, 0, 1]);
  });
});
