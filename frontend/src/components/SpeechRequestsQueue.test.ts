import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import SpeechRequestsQueue from './SpeechRequestsQueue.svelte';

const mocks = vi.hoisted(() => ({ dismissLog: vi.fn() }));
vi.mock('../lib/polling', () => ({ dismissLog: mocks.dismissLog }));

beforeEach(() => {
  resetSessionData();
  app.sessionToken = '758c';
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  app.speechQueueOpen = true;
  app.vehicles = [{ id: 4, game_vehicle_id: '4_RTW_B', name: '4-RTW-B', type: 'RTW', modes: null, x: 0, y: 0, status: 5, assigned_player_id: null }];
  app.events = [{ id: 1030, game_event_id: '30', name: 'Verkehrsunfall E-CALL', x: 0, y: 0, status: 'active', created_by: 'game' }];
  app.assignments = [{ event_id: 1030, vehicle_id: 4 }];
  app.logs = [{
    id: 21,
    type: 'vehicle',
    entity_id: '4_RTW_B',
    event_id: 1030,
    message: 'Sprechwunsch',
    long_message: 'Rettung Auenburg 4-RTW-B mit Sprechwunsch',
    state: 'active',
    created_at: '2026-08-10 00:00:00',
    updated_at: '2026-08-10 00:00:00',
  }];
  mocks.dismissLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('Sprechwunsch-Warteschlange', () => {
  it('zeigt Fahrzeug, Einsatz und Klinikaktion', () => {
    app.vehicles = [{ ...app.vehicles[0], status: 4 }];
    render(SpeechRequestsQueue);

    expect(screen.getByText('4-RTW-B')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText(/Verkehrsunfall E-CALL/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Klinik für 4-RTW-B/ })).toBeTruthy();
  });

  it('öffnet aus der Warteschlange den zugehörigen Einsatz', async () => {
    const user = userEvent.setup();
    render(SpeechRequestsQueue);

    await user.click(screen.getByRole('button', { name: /Einsatz Verkehrsunfall E-CALL öffnen/ }));

    expect(app.assignEvent?.id).toBe(1030);
    expect(app.speechQueueOpen).toBe(false);
  });

  it('arbeitet den Sprechwunsch über den bestehenden Funkverlauf ab', async () => {
    const user = userEvent.setup();
    render(SpeechRequestsQueue);

    await user.click(screen.getByRole('button', { name: /Sprechwunsch von 4-RTW-B abarbeiten/ }));

    await waitFor(() => expect(mocks.dismissLog).toHaveBeenCalledWith(21));
  });

  it('führt zwei Sprechwünsche desselben Fahrzeugs getrennt', async () => {
    app.logs = [
      { ...app.logs[0], occurrence_id: 101 },
      {
        ...app.logs[0],
        id: 22,
        occurrence_id: 102,
        created_at: '2026-08-10 00:15:00',
        updated_at: '2026-08-10 00:15:00',
      },
    ];
    const user = userEvent.setup();
    render(SpeechRequestsQueue);

    const doneButtons = screen.getAllByRole('button', { name: /Sprechwunsch von 4-RTW-B abarbeiten/ });
    expect(doneButtons).toHaveLength(2);
    await user.click(doneButtons[0]);

    await waitFor(() => expect(mocks.dismissLog).toHaveBeenCalledWith(21));
    expect(mocks.dismissLog).not.toHaveBeenCalledWith(22);
  });

  it('zeigt für nicht getrackte Einheiten keinen Status an', () => {
    app.vehicles = [{ ...app.vehicles[0], game_vehicle_id: 'FuSTW', name: 'Streifenwagen', type: 'FUSTW', status: 0 }];
    app.logs = [{ ...app.logs[0], entity_id: 'FuSTW', long_message: 'Streifenwagen mit Sprechwunsch' }];

    const { container } = render(SpeechRequestsQueue);

    expect(screen.getByText('Streifenwagen')).toBeTruthy();
    expect(container.querySelector('.status-badge')).toBeNull();
  });
});
