import { cleanup, render, screen } from '@testing-library/svelte';
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

describe('FMS-LOG', () => {
  it('zeigt Sprechwünsche nur als Eintrag in der Chronologie', () => {
    render(LogPanel);

    expect(screen.getByText('4-RTW-B')).toBeTruthy();
    expect(screen.queryByText('4_RTW_B')).toBeNull();
    expect(screen.getByText('Florian Auenburg 4-RTW-B mit Sprechwunsch')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Klinik .* zuweisen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Einsatz öffnen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Meldung abarbeiten' })).toBeNull();
  });

  it('kennzeichnet abgearbeitete Sprechwünsche weiterhin im Verlauf', () => {
    app.logs = [{ ...app.logs[0], state: 'inactive' }];
    render(LogPanel);

    expect(screen.getByLabelText('Abgearbeitet')).toBeTruthy();
  });

  it('behält die Aktionen für andere Funkmeldungen bei', () => {
    app.logs = [{
      ...app.logs[0],
      message: 'Rückmeldung',
      long_message: 'Fahrzeug meldet Einsatzstelle erreicht',
    }];
    render(LogPanel);

    expect(screen.getByRole('button', { name: 'Einsatz öffnen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Meldung abarbeiten' })).toBeTruthy();
  });

  it('führt Statuswechsel mit Uhrzeit, Fahrzeugname und Badge auf', () => {
    app.statusHistory = [{ id: 8, game_vehicle_id: '4_RTW_B', vehicle_name: '4-RTW-B', status: 5, created_at: '2026-08-09 20:46:00' }];
    render(LogPanel);

    expect(screen.getByRole('heading', { name: 'FMS-LOG' })).toBeTruthy();
    expect(screen.getByText('20:46')).toBeTruthy();
    expect(screen.getByLabelText('Sprechwunsch').textContent).toBe('5');
  });
});
