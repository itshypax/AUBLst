import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import CurrentEventPanel from './CurrentEventPanel.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn(), refreshState: vi.fn() }));
vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../lib/polling', () => ({ refreshState: mocks.refreshState }));

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
  mocks.refreshState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('Aktueller Einsatz', () => {
  it('zeigt Position und Zeit gemeinsam links vom Alarmieren-Button', () => {
    const timedEvent = { ...app.assignEvent!, created_at: '2026-08-15 18:36:42' };
    app.assignEvent = timedEvent;
    app.events = [timedEvent];

    const { container } = render(CurrentEventPanel);

    const meta = screen.getByText('Position 100.0, 200.0').closest('.event-meta');
    expect(meta?.textContent).toContain('18:36:42');
    expect(container.querySelector('.event-summary')?.children).toHaveLength(3);
    expect(container.querySelector('.event-summary')?.lastElementChild).toBe(screen.getByRole('button', { name: 'Alarmieren' }));
  });

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

  it('merkt Polizei, Bestatter und Abschlepper über die Schnellwahl vor', async () => {
    app.logs = [];
    app.assignments = [];
    app.vehicles = [
      { id: 31, game_vehicle_id: 'ASF', name: 'Abschleppwagen', type: 'ASF', modes: '1,2,3,4,Masterlift,Tieflader', x: -1000000, y: -1000000, status: 6, assigned_player_id: null },
      { id: 32, game_vehicle_id: 'FuSTW', name: 'Streifenwagen', type: 'FUSTW', modes: '1,2,3', x: -1000000, y: -1000000, status: 0, assigned_player_id: null },
      { id: 33, game_vehicle_id: 'BSW', name: 'Bestatter', type: 'BSW', modes: '1,2,3,4', x: -1000000, y: -1000000, status: 2, assigned_player_id: null },
    ];
    render(CurrentEventPanel);

    expect(screen.queryByText(/Oder in der Fahrzeugübersicht/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Streifenwagen vormerken' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Bestatter vormerken' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Abschleppwagen vormerken' }));

    expect(app.dispatchVehicleIds).toEqual([32, 33, 31]);
    expect(screen.getByRole('button', { name: 'Streifenwagen aus Vormerkung entfernen' }).getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Bestatter aus Vormerkung entfernen' }));
    expect(app.dispatchVehicleIds).toEqual([32, 31]);
  });

  it('zeigt ein wieder alarmierbares Einsatzfahrzeug als frühere Beteiligung und merkt es per Klick erneut vor', async () => {
    app.vehicles = [{ ...app.vehicles[0], status: 1 }];

    const { container } = render(CurrentEventPanel);

    const previousRow = container.querySelector('.vehicle-row.assigned.previous');
    expect(previousRow).not.toBeNull();
    expect(previousRow?.querySelector('.status-badge')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: '4-RTW-B erneut vormerken' }));

    expect(app.dispatchVehicleIds).toEqual([4]);
    expect(container.querySelector('.vehicle-row.assigned.previous')).toBeNull();
    expect(container.querySelector('.vehicle-row.staged')).not.toBeNull();
    expect(screen.getByRole('button', { name: '4-RTW-B entfernen' })).toBeTruthy();
  });

  it('zeigt ein frisch alarmiertes Fahrzeug während der Spielübernahme normal mit seinem letzten Status', async () => {
    app.assignments = [];
    app.vehicles = [{ ...app.vehicles[0], status: 2 }];
    app.dispatchVehicleIds = [4];
    mocks.api.mockImplementation(async (action: string) => {
      if (action === 'state') return { vehicles: app.vehicles };
      if (action === 'events_get_feedback') return { feedback: [] };
      return {};
    });
    mocks.refreshState.mockImplementation(async () => {
      app.assignments = [{ event_id: 1030, vehicle_id: 4 }];
    });

    const { container } = render(CurrentEventPanel);
    await fireEvent.click(screen.getByRole('button', { name: 'Alarmieren (1)' }));

    await waitFor(() => expect(container.querySelector('.vehicle-row.assigned')).not.toBeNull());
    const assignedRow = container.querySelector('.vehicle-row.assigned');
    expect(assignedRow?.classList.contains('previous')).toBe(false);
    expect(assignedRow?.querySelector('.status-badge')?.textContent).toContain('2');
    expect(screen.queryByRole('button', { name: '4-RTW-B erneut vormerken' })).toBeNull();

    app.vehicles = [{ ...app.vehicles[0], status: 3 }];
    await waitFor(() => expect(assignedRow?.querySelector('.status-badge')?.textContent).toContain('3'));
    app.vehicles = [{ ...app.vehicles[0], status: 1 }];
    await waitFor(() => expect(container.querySelector('.vehicle-row.assigned.previous')).not.toBeNull());
  });

  it('öffnet für ein aktives Einsatzfahrzeug das gemeinsame Fahrzeugmenü', async () => {
    const { container } = render(CurrentEventPanel);
    const row = container.querySelector('.vehicle-row.assigned');
    expect(row).not.toBeNull();

    await fireEvent.contextMenu(row!, { clientX: 140, clientY: 85 });

    expect(app.contextMenu).toEqual({ vehicleId: 4, x: 140, y: 85 });
  });

  it('öffnet für eine frühere kursive Beteiligung kein Fahrzeugmenü', async () => {
    app.vehicles = [{ ...app.vehicles[0], status: 1 }];
    const { container } = render(CurrentEventPanel);
    const row = container.querySelector('.vehicle-row.assigned.previous');
    expect(row).not.toBeNull();

    await fireEvent.contextMenu(row!, { clientX: 140, clientY: 85 });

    expect(app.contextMenu).toBeNull();
  });

  it('zeigt den alarmierten Dropdown-Wert in Klammern hinter dem Fahrzeug', () => {
    app.vehicles = [{
      id: 41,
      game_vehicle_id: '1_WLF_1',
      name: '1-WLF-1',
      type: 'WLF',
      modes: 'AB-Rüst,AB-Atemschutz',
      x: 0,
      y: 0,
      status: 4,
      assigned_player_id: null,
    }];
    app.assignments = [{ event_id: 1030, vehicle_id: 41, alarm_modes: ['AB-Rüst'] }];

    const { container } = render(CurrentEventPanel);

    expect(container.querySelector('.vehicle-row.assigned')?.textContent).toContain('1-WLF-1 (AB-Rüst)');
  });

  it('zeigt das Klinikziel eines zugeordneten RTW unter dem Fahrzeugnamen', () => {
    app.vehicles = [{ ...app.vehicles[0], status: 4 }];
    app.hospitalReservations = [{
      id: 11,
      vehicle_id: 4,
      hospital_id: 2,
      bed_type: 'ward',
      status: 'reserved',
      created_at: '2026-08-16 20:00:00',
      updated_at: '2026-08-16 20:00:00',
      arrived_at: null,
      game_vehicle_id: '4_RTW_B',
      vehicle_name: '4-RTW-B',
      hospital_name: 'Uniklinik',
    }];

    const { container } = render(CurrentEventPanel);

    const destination = screen.getByText('→ Uniklinik');
    expect(destination.classList.contains('destination')).toBe(true);
    expect(container.querySelector('.vehicle-row.assigned')?.getAttribute('aria-label')).toBe('4-RTW-B, Ziel Uniklinik');
  });

  it('zeigt getrennte Alarmierungen derselben Einheit einzeln an', () => {
    app.logs = [];
    app.vehicles = [{
      id: 42,
      game_vehicle_id: 'ASF',
      name: 'Abschleppwagen',
      type: 'ASF',
      modes: '1,2,3,4,Masterlift,Tieflader',
      x: -1000000,
      y: -1000000,
      status: 2,
      assigned_player_id: null,
    }];
    app.assignments = [{ event_id: 1030, vehicle_id: 42, alarm_modes: ['1', '2'] }];

    const { container } = render(CurrentEventPanel);

    expect(container.querySelector('.vehicle-row.assigned')?.textContent).toContain('Abschleppwagen (1) (2)');
  });

  it('zeigt nicht getrackte Einheiten normal und alarmiert sie nur über Schnellwahl oder Suche erneut', async () => {
    app.logs = [];
    app.vehicles = [
      { id: 31, game_vehicle_id: 'ASF', name: 'Abschleppwagen', type: 'ASF', modes: '1,2,3,4,Masterlift,Tieflader', x: -1000000, y: -1000000, status: 6, assigned_player_id: null },
      { id: 32, game_vehicle_id: 'FuSTW', name: 'Streifenwagen', type: 'FUSTW', modes: '1,2,3', x: -1000000, y: -1000000, status: 0, assigned_player_id: null },
      { id: 33, game_vehicle_id: 'TD', name: 'Stadtwerke', type: 'TD', modes: null, x: -1000000, y: -1000000, status: 4, assigned_player_id: null },
    ];
    app.assignments = app.vehicles.map((vehicle) => ({ event_id: 1030, vehicle_id: vehicle.id }));

    const { container } = render(CurrentEventPanel);

    expect(container.querySelectorAll('.vehicle-row.assigned')).toHaveLength(3);
    expect(container.querySelector('.vehicle-row.assigned.previous')).toBeNull();
    expect(container.querySelector('.status-badge')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abschleppwagen erneut vormerken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Streifenwagen erneut vormerken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stadtwerke erneut vormerken' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Abschleppwagen vormerken' }));
    await fireEvent.change(screen.getByRole('combobox', { name: 'Ausrückmodus für Abschleppwagen' }), { target: { value: '3' } });

    expect(app.dispatchVehicleIds).toEqual([31]);
    expect(container.querySelector('.vehicle-row.staged .status-badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alarmieren (3)' })).toBeTruthy();
  });

  it('merkt eine bereits zugeordnete versteckte Einheit über die Suche erneut vor', async () => {
    app.logs = [];
    app.vehicles = [{
      id: 33,
      game_vehicle_id: 'TD',
      name: 'Stadtwerke',
      type: 'TD',
      modes: null,
      x: -1000000,
      y: -1000000,
      status: 4,
      assigned_player_id: null,
    }];
    app.assignments = [{ event_id: 1030, vehicle_id: 33 }];
    render(CurrentEventPanel);

    const search = screen.getByPlaceholderText('Fahrzeug suchen …');
    await fireEvent.focus(search);
    await fireEvent.input(search, { target: { value: 'Stadtwerke' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Stadtwerke' }));

    expect(app.dispatchVehicleIds).toEqual([33]);
    expect(screen.getByRole('button', { name: 'Stadtwerke entfernen' })).toBeTruthy();
  });

  it('hat keinen eigenen Schließen-Knopf', () => {
    render(CurrentEventPanel);

    expect(screen.queryByRole('button', { name: 'Einsatzansicht schließen' })).toBeNull();
  });
});
