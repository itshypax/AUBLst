import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import LogPanel from './LogPanel.svelte';

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  app.vehicles = [{ id: 4, game_vehicle_id: '4_RTW_B', name: '4-RTW-B', type: 'RTW', modes: null, x: 0, y: 0, status: 5, assigned_player_id: null }];
  app.logs = [{
    id: 22,
    type: 'vehicle',
    entity_id: '4_RTW_B',
    event_id: 1034,
    message: 'Sprechwunsch',
    long_message: 'Florian Auenburg 4-RTW-B mit Sprechwunsch',
    state: 'active',
    updated_at: '2026-08-09 20:45:00',
  }];
});

afterEach(() => cleanup());

describe('Funkmeldungen', () => {
  it('öffnet aus einem Sprechwunsch direkt die Klinikzuweisung', async () => {
    const user = userEvent.setup();
    render(LogPanel);

    await user.click(screen.getByRole('button', { name: 'Klinik für 4-RTW-B zuweisen' }));

    expect(app.hospitalAssignmentVehicleId).toBe(4);
  });
});
