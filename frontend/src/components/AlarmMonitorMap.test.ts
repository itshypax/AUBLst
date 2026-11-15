import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import AlarmMonitorMap from './AlarmMonitorMap.svelte';

beforeEach(() => {
  resetSessionData();
  app.mapBounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 500 };
  app.mapImageUrl = 'blob:test-map';
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Alarmmonitor-Karte', () => {
  it('beschriftet Einsatz und Fahrzeugmarker vollständig', async () => {
    const event = {
      id: 10,
      game_event_id: '47',
      name: 'Wohnungsbrand',
      x: 750,
      y: -250,
      status: 'active' as const,
      created_by: 'game' as const,
    };
    const vehicle = {
      id: 1,
      game_vehicle_id: '1_HLF_1',
      name: 'Florian Auenburg 1-HLF-1',
      type: 'HLF',
      modes: null,
      x: 730,
      y: -240,
      status: 4,
      assigned_player_id: null,
    };

    const { container } = render(AlarmMonitorMap, {
      props: {
        incidents: [{ event, vehicles: [vehicle] }],
        focusEventId: 10,
      },
    });

    await waitFor(() => expect(container.querySelector('.event-marker strong')?.textContent).toBe('Wohnungsbrand'));
    expect(container.querySelector('.vehicle-marker .vehicle-name')?.textContent).toBe('Florian Auenburg 1-HLF-1');
    expect(container.querySelector('img')?.style.transform).toContain('scale(2.4)');
  });

  it('zeigt alarmierte Fahrzeuge wie überall mit C', async () => {
    const event = {
      id: 11,
      game_event_id: '48',
      name: 'Brand',
      x: 500,
      y: -250,
      status: 'active' as const,
      created_by: 'game' as const,
    };
    const vehicle = {
      id: 2,
      game_vehicle_id: '1_DLK_1',
      name: '1-DLK-1',
      type: 'DLK',
      modes: null,
      x: 400,
      y: -200,
      status: 0,
      alarm_from_status: 2,
      assigned_player_id: null,
    };

    const { container } = render(AlarmMonitorMap, { props: { incidents: [{ event, vehicles: [vehicle] }] } });

    await waitFor(() => expect(container.querySelector('.vehicle-flag b')?.textContent).toBe('2C'));
  });
});
