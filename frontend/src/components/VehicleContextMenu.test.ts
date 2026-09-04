import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import VehicleContextMenu from './VehicleContextMenu.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn(), refreshState: vi.fn() }));

vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../lib/polling', () => ({ refreshState: mocks.refreshState }));

beforeEach(() => {
  mocks.api.mockReset();
  mocks.refreshState.mockReset();
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.connected = true;
  app.lastSuccessfulSync = Date.now();
  app.vehicles = [{
    id: 1,
    game_vehicle_id: '1_HLF_1',
    name: '1-HLF-1',
    type: 'HLF',
    modes: null,
    x: 100,
    y: -100,
    status: 4,
    assigned_player_id: null,
  }];
  app.contextMenu = { x: 20, y: 20, vehicleId: 1 };
});

afterEach(() => cleanup());

describe('Fahrzeugmenü', () => {
  it('setzt ein Fahrzeug per Rechtsklick außer Dienst', async () => {
    const user = userEvent.setup();
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Außer Dienst setzen (Status 6)' }));

    expect(mocks.api).toHaveBeenCalledWith('vehicles_set_unavailable', { vehicle_id: 1, unavailable: true });
    expect(mocks.refreshState).toHaveBeenCalled();
  });

  it('bietet bei manuellem Status 6 den Weg zurück zum Spielstatus an', async () => {
    const user = userEvent.setup();
    app.vehicles = [{ ...app.vehicles[0], status: 6, game_status: 4, unavailable_override: 1 }];
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    expect(screen.queryByRole('menuitem', { name: 'Außer Dienst setzen (Status 6)' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Wieder in Dienst (Status 4)' }));

    expect(mocks.api).toHaveBeenCalledWith('vehicles_set_unavailable', { vehicle_id: 1, unavailable: false });
  });

  it('lässt einen vom Spiel gemeldeten Status 6 unangetastet', () => {
    app.vehicles = [{ ...app.vehicles[0], status: 6, game_status: 6, unavailable_override: 0 }];
    render(VehicleContextMenu);

    expect(screen.queryByRole('menuitem', { name: /Außer Dienst|Wieder in Dienst/ })).toBeNull();
  });

  it('zeigt die Einsatzleiteraktionen nicht in der Fahrzeugübersicht', () => {
    app.events = [{ id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1 }];
    render(VehicleContextMenu);

    expect(screen.queryByRole('menuitem', { name: /Einsatzleiter FW|Einsatzleiter RD/ })).toBeNull();
  });

  it('setzt den Einsatzleiter FW aus dem einsatzbezogenen Rechtsklickmenü', async () => {
    const user = userEvent.setup();
    app.events = [{ id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1 }];
    app.contextMenu = { x: 20, y: 20, vehicleId: 1, eventId: 1000 };
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Als Einsatzleiter FW setzen' }));

    expect(mocks.api).toHaveBeenCalledWith('events_set_leader', { event_id: 1000, vehicle_id: 1, role: 'fire' });
  });

  it('schaltet den manuellen Einsatzleiter FW zurück auf Automatik', async () => {
    const user = userEvent.setup();
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '2_ELW_1', name: '2-ELW-1', type: 'ELW' };
    app.events = [{ id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1, leader_role: 'fire', leader_source: 'manual' }];
    app.contextMenu = { x: 20, y: 20, vehicleId: 1, eventId: 1000 };
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Einsatzleiter FW automatisch bestimmen' }));

    expect(mocks.api).toHaveBeenCalledWith('events_set_leader', { event_id: 1000, vehicle_id: null, role: 'fire' });
  });

  it('übersteuert die automatische Auswahl des Einsatzleiters RD manuell', async () => {
    const user = userEvent.setup();
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '72_RTW_1', name: '72-RTW-1', type: 'RTW' };
    app.events = [{ id: 1000, game_event_id: '10', name: 'MANV', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1, leader_role: 'medical', leader_source: 'automatic' }];
    app.contextMenu = { x: 20, y: 20, vehicleId: 1, eventId: 1000 };
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Einsatzleiter RD manuell festlegen' }));

    expect(mocks.api).toHaveBeenCalledWith('events_set_leader', { event_id: 1000, vehicle_id: 1, role: 'medical' });
  });

  it('schaltet den manuellen Einsatzleiter RD zurück auf Automatik', async () => {
    const user = userEvent.setup();
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '72_RTW_1', name: '72-RTW-1', type: 'RTW' };
    app.events = [{ id: 1000, game_event_id: '10', name: 'MANV', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1, leader_role: 'medical', leader_source: 'manual' }];
    app.contextMenu = { x: 20, y: 20, vehicleId: 1, eventId: 1000 };
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Einsatzleiter RD automatisch bestimmen' }));

    expect(mocks.api).toHaveBeenCalledWith('events_set_leader', { event_id: 1000, vehicle_id: null, role: 'medical' });
  });

  it('ordnet ein Fahrzeug lokal einem anderen Einsatz zu', async () => {
    const user = userEvent.setup();
    app.events = [
      { id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' },
      { id: 1001, game_event_id: '11', name: 'Verkehrsunfall', x: 0, y: 0, status: 'active', created_by: 'game' },
    ];
    app.assignments = [{ event_id: 1000, vehicle_id: 1 }];
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Anderem Einsatz zuordnen' }));
    await user.click(screen.getByRole('menuitem', { name: /Verkehrsunfall/ }));

    expect(mocks.api).toHaveBeenCalledWith('events_reassign', { vehicle_id: 1, event_id: 1001 });
  });

  it('lässt ein Fahrzeug nur aus dem Einsatz des geöffneten Menüs einrücken', async () => {
    const user = userEvent.setup();
    app.events = [{ id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' }];
    app.assignments = [{ event_id: 1000, vehicle_id: 1 }];
    app.contextMenu = { x: 20, y: 20, vehicleId: 1, eventId: 1000 };
    mocks.api.mockResolvedValue({ ok: true });
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Einrücken lassen' }));

    expect(mocks.api).toHaveBeenCalledWith('events_unassign', { event_id: 1000, vehicle_ids: [1] });
  });

  it('hält lange Zieleinsätze innerhalb der festen Menübreite', async () => {
    const user = userEvent.setup();
    app.events = [
      { id: 1000, game_event_id: '10', name: 'Wohnungsbrand', x: 0, y: 0, status: 'active', created_by: 'game' },
      { id: 1001, game_event_id: '11', name: 'Verkehrsunfall mit mehreren beteiligten Fahrzeugen auf der Autobahn', x: 0, y: 0, status: 'active', created_by: 'game' },
    ];
    app.assignments = [{ event_id: 1000, vehicle_id: 1 }];
    render(VehicleContextMenu);

    await user.click(screen.getByRole('menuitem', { name: 'Anderem Einsatz zuordnen' }));

    const target = screen.getByRole('menuitem', { name: /Verkehrsunfall mit mehreren/ });
    expect(target.querySelector('span')?.textContent).toContain('Verkehrsunfall mit mehreren');
    expect(target.querySelector('span')?.classList.contains('event-name')).toBe(true);
  });

  it.each([4, 5, 7])('bietet einem RTW in Status %i die Klinikzuweisung an', (status) => {
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '72_RTW_1', name: '72-RTW-1', type: 'RTW', status };
    render(VehicleContextMenu);

    expect(screen.getByRole('menuitem', { name: 'Klinik zuweisen' })).toBeTruthy();
  });

  it('bietet auch einem ITW die Klinikzuweisung an', () => {
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '4_ITW_A', name: '4-ITW-A', type: 'ITW', status: 5 };
    render(VehicleContextMenu);

    expect(screen.getByRole('menuitem', { name: 'Klinik zuweisen' })).toBeTruthy();
  });

  it('zeigt nach der Ankunft keine abgeschlossene Klinikzuweisung mehr an', () => {
    app.vehicles[0] = { ...app.vehicles[0], game_vehicle_id: '72_RTW_1', name: '72-RTW-1', type: 'RTW', status: 8 };
    app.hospitalReservations = [{
      id: 9,
      vehicle_id: 1,
      hospital_id: 2,
      bed_type: 'ward',
      status: 'arrived',
      created_at: '2026-08-09 12:00:00',
      updated_at: '2026-08-09 12:05:00',
      arrived_at: '2026-08-09 12:05:00',
      game_vehicle_id: '72_RTW_1',
      vehicle_name: '72-RTW-1',
      hospital_name: 'Hanseklinik',
    }];
    render(VehicleContextMenu);

    expect(screen.queryByRole('menuitem', { name: 'Klinikzuweisung ändern' })).toBeNull();
  });
});
