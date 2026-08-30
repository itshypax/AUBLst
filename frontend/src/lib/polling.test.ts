import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from './state.svelte';
import type { LogRow } from './types';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiGet: vi.fn(),
  fetchMapImage: vi.fn(),
  playPhone: vi.fn(),
  playSoundCue: vi.fn(),
  playSoundCues: vi.fn(),
}));

vi.mock('./api', () => ({ api: mocks.api, apiGet: mocks.apiGet, fetchMapImage: mocks.fetchMapImage }));
vi.mock('./sounds', () => ({
  getSoundAlertConfig: () => ({
    unassignedVehicleStatuses: [3, 4],
    unassignedVehicleExceptions: [],
    vehicleCTimeoutSeconds: 120,
    vehicleCTimeoutOverrides: {},
    speechRequestTimeoutSeconds: 120,
  }),
  playPhone: mocks.playPhone,
  playSoundCue: mocks.playSoundCue,
  playSoundCues: mocks.playSoundCues,
}));

function row(id: number): LogRow {
  return {
    id,
    type: 'vehicle',
    entity_id: `vehicle-${id}`,
    event_id: null,
    message: 'S1',
    long_message: `Meldung ${id}`,
    state: 'active',
    updated_at: '2026-08-09 14:35:00',
  };
}

beforeEach(() => {
  mocks.api.mockReset().mockResolvedValue({ ok: true });
  mocks.apiGet.mockReset();
  mocks.fetchMapImage.mockReset();
  mocks.playPhone.mockReset();
  mocks.playSoundCue.mockReset();
  mocks.playSoundCues.mockReset();
  resetSessionData();
  app.sessionToken = 'demo';
});

describe('Kartenabruf', () => {
  it('verwendet für den Alarmmonitor nur den schlanken Zustandsabruf', async () => {
    const state = {
      session: {
        token: 'demo',
        mod_id: null,
        map_bounds: { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 },
      },
      players: [],
      vehicles: [],
      hospitals: [],
      events: [],
      assignments: [],
      hospital_reservations: [],
      status_history: [],
      time: null,
    };
    mocks.apiGet.mockResolvedValue(state);
    const { pollingProfile, refreshState, switchSession } = await import('./polling');

    expect(pollingProfile(true)).toEqual({
      stateAction: 'monitor_state',
      pollsLogs: false,
      pollsStatusHistory: false,
      usesRealtime: false,
    });

    await switchSession('../backend/api.php', 'demo', '', { readOnly: true });
    await refreshState();

    expect(mocks.apiGet).toHaveBeenCalledWith('monitor_state', {}, expect.any(Object));
    expect(mocks.apiGet).not.toHaveBeenCalledWith('logs', expect.anything(), expect.anything());

    await switchSession('../backend/api.php', 'demo', '', { readOnly: false });
  });

  it('lädt den Fahrzeugstatusverlauf getrennt vom Live-Zustand', async () => {
    const history = [{ id: 9, game_vehicle_id: '1_HLF_1', vehicle_name: '1-HLF-1', status: 4, created_at: '2026-08-29 20:00:00' }];
    mocks.apiGet.mockResolvedValue({ status_history: history });
    const { refreshStatusHistory } = await import('./polling');

    await refreshStatusHistory();

    expect(mocks.apiGet).toHaveBeenCalledWith('status_history', {}, expect.any(Object));
    expect(app.statusHistory).toEqual(history);
  });

  it('wiederholt einen abgebrochenen Abruf bei unveränderter Mod-ID', async () => {
    const state = {
      session: {
        token: 'demo',
        mod_id: 'AUBMP',
        map_bounds: { min_x: -16384, min_y: -16384, max_x: 16384, max_y: 16384 },
      },
      players: [],
      vehicles: [],
      hospitals: [],
      events: [],
      assignments: [],
      hospital_reservations: [],
      time: null,
    };
    const routing = {
      coordinate_space: 'world',
      meters_per_world_unit: 0.1,
      grid_size_m: 50,
      nodes: [],
      edges: [],
    };
    mocks.apiGet.mockImplementation((action: string) => Promise.resolve(action === 'state' ? state : routing));
    mocks.fetchMapImage.mockResolvedValue('blob:aubmp');
    app.modId = 'AUBMP';
    app.mapImageUrl = '';
    const { refreshState } = await import('./polling');

    await refreshState();

    expect(mocks.fetchMapImage).toHaveBeenCalledOnce();
    expect(app.mapImageUrl).toBe('blob:aubmp');
  });

  it('lädt die umgerechneten BMA-Zonen bei geänderten Kartengrenzen neu', async () => {
    const state = (maxX: number) => ({
      session: {
        token: 'demo',
        mod_id: 'AUBMP',
        map_bounds: { min_x: 0, min_y: 0, max_x: maxX, max_y: 1000 },
      },
      players: [],
      vehicles: [],
      hospitals: [],
      events: [],
      assignments: [],
      hospital_reservations: [],
      time: null,
    });
    const routing = {
      coordinate_space: 'world',
      meters_per_world_unit: 0.1,
      grid_size_m: 50,
      nodes: [],
      edges: [],
      bma_zones: [],
    };
    let stateRequests = 0;
    mocks.apiGet.mockImplementation((action: string) => {
      if (action === 'state') return Promise.resolve(state(++stateRequests === 1 ? 1000 : 2000));
      return Promise.resolve(routing);
    });
    mocks.fetchMapImage.mockResolvedValue('blob:aubmp');
    app.mapBounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 };
    const { refreshState } = await import('./polling');

    await refreshState();
    await refreshState();

    expect(mocks.apiGet.mock.calls.filter(([action]) => action === 'routing_get')).toHaveLength(2);
    expect(mocks.fetchMapImage).toHaveBeenCalledOnce();
  });
});

describe('Funk-Polling', () => {
  it('bleibt beim ersten Verlauf stumm und fragt gleiche Sekunden mit ID weiter ab', async () => {
    mocks.apiGet.mockResolvedValueOnce({ logs: [row(10)] }).mockResolvedValueOnce({ logs: [row(11)] });
    const { pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    expect(mocks.playSoundCues).not.toHaveBeenCalled();
    await pollLogs();

    expect(mocks.apiGet).toHaveBeenLastCalledWith(
      'logs',
      { since: '2026-08-09 14:35:00', since_id: 0 },
      expect.any(Object),
    );
    expect(mocks.playSoundCues).toHaveBeenCalledWith(['radio-message']);
    expect(app.logs.map((item) => item.id)).toEqual([10, 11]);
  });

  it('spielt für einen neuen Sprechwunsch den eigenen Ton', async () => {
    const initial = row(20);
    const speechRequest = {
      ...row(21),
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
    };
    mocks.apiGet.mockResolvedValueOnce({ logs: [initial] }).mockResolvedValueOnce({ logs: [speechRequest] });
    const { pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await pollLogs();

    expect(mocks.playSoundCues).toHaveBeenCalledWith(['speech-request']);
  });

  it('spielt einen bestätigten Sprechwunsch nicht erneut ab', async () => {
    const speechRequest = {
      ...row(21),
      occurrence_id: 101,
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
      acknowledged: 0,
      updated_at: '2026-08-09 14:35:00.100000',
    };
    const acknowledged = {
      ...speechRequest,
      acknowledged: 1,
      updated_at: '2026-08-09 14:35:01.100000',
    };
    mocks.apiGet.mockResolvedValueOnce({ logs: [speechRequest] }).mockResolvedValueOnce({ logs: [acknowledged] });
    const { pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await pollLogs();

    expect(app.logs.find((item) => item.id === 21)?.acknowledged).toBe(1);
    expect(mocks.playSoundCues).not.toHaveBeenCalled();
  });

  it('öffnet einen erledigten Sprechwunsch durch einen älteren Poll nicht erneut', async () => {
    const speechRequest = {
      ...row(21),
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
    };
    mocks.apiGet.mockResolvedValueOnce({ logs: [speechRequest] }).mockResolvedValueOnce({ logs: [speechRequest] });
    const { dismissLog, pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await dismissLog(21);
    await pollLogs();

    expect(app.logs.find((item) => item.id === 21)?.state).toBe('inactive');
  });

  it('lässt eine geänderte Legacy-Meldung mit derselben Datenbank-ID wieder durch', async () => {
    const firstRequest = {
      ...row(21),
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
      updated_at: '2026-08-09 14:35:00.100000',
    };
    const nextRequest = { ...firstRequest, updated_at: '2026-08-09 14:36:00.100000' };
    mocks.api.mockResolvedValueOnce({ ok: true, updated_at: '2026-08-09 14:35:01.100000' });
    mocks.apiGet.mockResolvedValueOnce({ logs: [firstRequest] }).mockResolvedValueOnce({ logs: [nextRequest] });
    const { dismissLog, pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await dismissLog(21);
    await pollLogs();

    expect(app.logs.find((item) => item.id === 21)?.state).toBe('active');
    expect(mocks.playSoundCues).toHaveBeenCalledWith(['speech-request']);
  });

  it('führt ein neues Status-5-Vorkommnis als eigene Meldung', async () => {
    const firstRequest = {
      ...row(21),
      occurrence_id: 101,
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
      created_at: '2026-08-09 14:35:00.100000',
      updated_at: '2026-08-09 14:35:00.100000',
    };
    const nextRequest = {
      ...firstRequest,
      id: 22,
      occurrence_id: 102,
      created_at: '2026-08-09 14:50:00.100000',
      updated_at: '2026-08-09 14:50:00.100000',
    };
    mocks.api.mockResolvedValueOnce({ ok: true, updated_at: '2026-08-09 14:35:01.100000' });
    mocks.apiGet.mockResolvedValueOnce({ logs: [firstRequest] }).mockResolvedValueOnce({ logs: [nextRequest] });
    const { dismissLog, pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await dismissLog(21);
    await pollLogs();

    expect(app.logs.find((item) => item.id === 21)?.state).toBe('inactive');
    expect(app.logs.find((item) => item.id === 22)?.state).toBe('active');
    expect(mocks.playSoundCues).toHaveBeenCalledWith(['speech-request']);
  });

  it('arbeitet alle Meldungsvarianten eines Sprechwunsches gemeinsam ab', async () => {
    const first = {
      ...row(21),
      occurrence_id: 101,
      message: 'Sprechwunsch',
      long_message: 'Florian Auenburg 1-HLF-1 mit Sprechwunsch',
    };
    const variant = { ...first, id: 22, message: 'FMS5' };
    mocks.api.mockResolvedValueOnce({
      ok: true,
      ids: [21, 22],
      updated_at: '2026-08-09 14:35:01.100000',
    });
    mocks.apiGet.mockResolvedValueOnce({ logs: [first, variant] });
    const { dismissLog, pollLogs, switchSession } = await import('./polling');
    await switchSession('../backend/api.php', 'demo', '');

    await pollLogs();
    await dismissLog(21);

    expect(app.logs.filter((item) => [21, 22].includes(item.id)).map((item) => item.state)).toEqual([
      'inactive',
      'inactive',
    ]);
  });

  it('bestätigt alle Meldungsvarianten eines Sprechwunsches gemeinsam', async () => {
    app.logs = [
      { ...row(21), occurrence_id: 101, acknowledged: false },
      { ...row(22), occurrence_id: 101, acknowledged: false },
    ];
    mocks.api.mockResolvedValueOnce({
      ok: true,
      ids: [21, 22],
      updated_at: '2026-08-09 14:35:01.100000',
    });
    const { acknowledgeLog } = await import('./polling');

    await acknowledgeLog(21);

    expect(app.logs.map((item) => item.acknowledged)).toEqual([true, true]);
  });
});
