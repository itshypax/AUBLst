import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import CurrentEventPanel from './CurrentEventPanel.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../lib/api', () => ({ api: mocks.api }));

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  const event = {
    id: 1030,
    game_event_id: '30',
    name: 'Verkehrsunfall',
    x: 100,
    y: 200,
    status: 'active' as const,
    created_by: 'game' as const,
  };
  app.events = [event];
  app.assignEvent = event;
  app.vehicles = [{ id: 4, game_vehicle_id: '4_RTW_B', name: '4-RTW-B', type: 'RTW', modes: null, x: 0, y: 0, status: 5, assigned_player_id: null }];
  app.assignments = [{ event_id: 1030, vehicle_id: 4 }];
  app.logs = [{
    id: 21,
    type: 'vehicle',
    entity_id: '4_RTW_B',
    event_id: 1030,
    message: 'Sprechwunsch',
    long_message: 'Rettung Auenburg 4-RTW-B mit Sprechwunsch',
    state: 'active',
    created_at: '2026-08-11 20:00:00',
    updated_at: '2026-08-11 20:00:00',
  }];
  mocks.api.mockReset().mockResolvedValue({ feedback: [] });
});

afterEach(() => cleanup());

describe('Aktueller Einsatz', () => {
  it('zeigt ohne Suchtext alle verfügbaren Fahrzeuge im Dropdown', async () => {
    app.assignments = [];
    app.vehicles = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      game_vehicle_id: `${index + 1}_HLF_1`,
      name: `${index + 1}-HLF-1`,
      type: '200',
      modes: null,
      x: 0,
      y: 0,
      status: 2,
      assigned_player_id: null,
    }));
    render(CurrentEventPanel);

    await fireEvent.focus(screen.getByPlaceholderText('Fahrzeug suchen …'));

    expect(screen.getAllByText(/^\d+-HLF-1$/)).toHaveLength(12);
  });

  it('schließt die Fahrzeugauswahl bei einem Klick außerhalb', async () => {
    app.assignments = [];
    app.vehicles = [{ ...app.vehicles[0], status: 2 }];
    render(CurrentEventPanel);

    await fireEvent.focus(screen.getByPlaceholderText('Fahrzeug suchen …'));
    expect(screen.getByRole('button', { name: '4-RTW-B' })).toBeTruthy();

    await fireEvent.pointerDown(screen.getByRole('heading', { name: 'Aktueller Einsatz' }));

    expect(screen.queryByRole('button', { name: '4-RTW-B' })).toBeNull();
  });

  it('zeigt Entfernungen, aber weder Aktionsobjekte noch Status für versteckte Einheiten', async () => {
    app.assignments = [];
    app.vehicles = [
      { id: 1, game_vehicle_id: '1_HLF_1', name: '1-HLF-1', type: '200', modes: null, x: 0, y: 0, status: 2, assigned_player_id: null },
      { id: 2, game_vehicle_id: 'JA', name: 'Jaeger', type: 'None', modes: null, x: -1000000, y: -1000000, status: 2, assigned_player_id: null },
      { id: 3, game_vehicle_id: 'FS_LST_1', name: 'AuenPort', type: 'None', modes: 'Schiffsverkehr sperren', x: -1000000, y: -1000000, status: 2, assigned_player_id: null },
      { id: 4, game_vehicle_id: 'FS_LST_2', name: 'SWA Bahn', type: 'None', modes: 'Tramverkehr einstellen', x: -1000000, y: -1000000, status: 2, assigned_player_id: null },
    ];
    render(CurrentEventPanel);

    await fireEvent.focus(screen.getByPlaceholderText('Fahrzeug suchen …'));

    expect(screen.getByText('22 m')).toBeTruthy();
    expect(screen.queryByText('AuenPort')).toBeNull();
    expect(screen.queryByText('SWA Bahn')).toBeNull();
    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByRole('button', { name: 'Jaeger' }).querySelector('.status-badge')).toBeNull();
  });

  it('zeigt Sprechwünsche im Verlauf ohne eigene Aktion', () => {
    render(CurrentEventPanel);

    expect(screen.getByText('Rettung Auenburg 4-RTW-B mit Sprechwunsch')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sprechwunsch .* abarbeiten/ })).toBeNull();
  });

  it('zeigt Vormerkungen ohne separate Dispositionsspalte', () => {
    app.assignments = [];
    app.vehicles = [{ ...app.vehicles[0], status: 2 }];
    app.dispatchVehicleIds = [4];

    const { container } = render(CurrentEventPanel);

    expect(screen.queryByText('Disposition')).toBeNull();
    expect(screen.queryByText('Vorgemerkt')).toBeNull();
    expect(screen.queryByText('Alarmiert')).toBeNull();
    expect(screen.getByRole('button', { name: '4-RTW-B entfernen' })).toBeTruthy();
    expect(container.querySelector('.vehicle-row.staged')).not.toBeNull();
  });

  it('hat keinen eigenen Schließen-Knopf', () => {
    render(CurrentEventPanel);

    expect(screen.queryByRole('button', { name: 'Einsatzansicht schließen' })).toBeNull();
  });
});
