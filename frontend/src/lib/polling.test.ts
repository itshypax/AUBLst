import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from './state.svelte';
import type { LogRow } from './types';

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiGet: vi.fn(), playPhone: vi.fn(), playSoundCue: vi.fn(), playSoundCues: vi.fn() }));

vi.mock('./api', () => ({ api: mocks.api, apiGet: mocks.apiGet, fetchMapImage: vi.fn() }));
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
  mocks.playPhone.mockReset();
  mocks.playSoundCue.mockReset();
  mocks.playSoundCues.mockReset();
  resetSessionData();
  app.sessionToken = 'demo';
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
      expect.any(Object)
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
});
