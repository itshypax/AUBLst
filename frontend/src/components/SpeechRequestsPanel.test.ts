import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import SpeechRequestsPanel from './SpeechRequestsPanel.svelte';

const mocks = vi.hoisted(() => ({ acknowledgeLog: vi.fn(), dismissLog: vi.fn() }));
vi.mock('../lib/polling', () => ({
  acknowledgeLog: mocks.acknowledgeLog,
  dismissLog: mocks.dismissLog,
}));

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionData();
  app.sessionToken = '758c';
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  app.vehicles = [
    {
      id: 4,
      game_vehicle_id: '4_RTW_B',
      name: '4-RTW-B',
      type: 'RTW',
      modes: null,
      x: 0,
      y: 0,
      status: 5,
      assigned_player_id: null,
    },
  ];
  app.events = [
    { id: 1030, game_event_id: '30', name: 'Verkehrsunfall', x: 0, y: 0, status: 'active', created_by: 'game' },
  ];
  app.assignments = [{ event_id: 1030, vehicle_id: 4 }];
  app.logs = [
    {
      id: 21,
      occurrence_id: 101,
      type: 'vehicle',
      entity_id: '4_RTW_B',
      event_id: 1030,
      message: 'Sprechwunsch',
      long_message: 'Rettung Auenburg 4-RTW-B mit Sprechwunsch',
      state: 'active',
      acknowledged: false,
      created_at: '2026-08-10 10:00:00',
      updated_at: '2026-08-10 10:00:00',
    },
  ];
  mocks.acknowledgeLog.mockReset().mockResolvedValue(undefined);
  mocks.dismissLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Sprechwunsch-Tabelle', () => {
  it('kennzeichnet einen neuen Sprechwunsch als unbearbeitet', () => {
    render(SpeechRequestsPanel);

    expect(screen.getByText('4-RTW-B').closest('tr')?.classList.contains('unacknowledged')).toBe(true);
    expect(screen.getByRole('table', { name: 'Offene Sprechwünsche' }).hasAttribute('data-tooltip')).toBe(false);
    expect(screen.queryByRole('columnheader', { name: 'Einsatz' })).toBeNull();
    expect(screen.queryByText('Verkehrsunfall')).toBeNull();
  });

  it('öffnet und bestätigt einen Sprechwunsch mit einfachem Klick', async () => {
    render(SpeechRequestsPanel);

    await fireEvent.click(screen.getByText('4-RTW-B'));
    await vi.advanceTimersByTimeAsync(220);

    expect(app.assignEvent?.id).toBe(1030);
    expect(mocks.acknowledgeLog).toHaveBeenCalledWith(21);
  });

  it('erledigt einen Sprechwunsch mit Doppelklick', async () => {
    render(SpeechRequestsPanel);

    await fireEvent.dblClick(screen.getByText('4-RTW-B'));

    expect(app.assignEvent?.id).toBe(1030);
    expect(mocks.dismissLog).toHaveBeenCalledWith(21);
    expect(mocks.acknowledgeLog).not.toHaveBeenCalled();
  });

  it('zeigt die Klinikzuweisung im Rechtsklick-Menü', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(SpeechRequestsPanel);

    await fireEvent.contextMenu(screen.getByText('4-RTW-B'), { clientX: 100, clientY: 100 });
    await user.click(screen.getByRole('menuitem', { name: 'Klinik zuweisen' }));

    await waitFor(() => expect(app.hospitalAssignmentVehicleId).toBe(4));
  });
});
