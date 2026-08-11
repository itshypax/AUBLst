import { beforeEach, describe, expect, it } from 'vitest';
import { app, assignedEventForVehicle, initSettings, openAssign, resetSessionData, toggleDispatchVehicle } from './state.svelte';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetSessionData();
  history.replaceState(null, '', '/');
});

describe('Sitzungsdaten', () => {
  it('entfernt Zugangsdaten nach dem Einlesen aus der Adresszeile', () => {
    history.replaceState(null, '', '/?session_token=a1b2&pin=1234&api_base=%2Fapi.php');
    initSettings();
    expect(app.sessionToken).toBe('a1b2');
    expect(app.pin).toBe('1234');
    expect(location.search).toBe('?api_base=%2Fapi.php');
    expect(localStorage.getItem('pin')).toBeNull();
    expect(localStorage.getItem('sessionToken')).toBeNull();
    expect([...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index)).some((key) => key?.startsWith('sessionToken:'))).toBe(true);
  });

  it('setzt sichtbare Daten beim Sitzungswechsel zurück', async () => {
    const { switchSession } = await import('./polling');
    app.logs = [{
      id: 1,
      type: 'vehicle',
      entity_id: 'old',
      event_id: null,
      message: 'S1',
      long_message: 'Alte Sitzung',
      state: 'active',
      updated_at: '2026-08-09 10:00:00',
    }];
    app.events = [{ id: 1, game_event_id: 'old', name: 'Alt', x: 0, y: 0, status: 'active', created_by: 'game' }];
    await switchSession('/new-api.php', 'b2c3', '5678');
    expect(app.logs).toEqual([]);
    expect(app.events).toEqual([]);
    expect(app.sessionToken).toBe('b2c3');
    expect(app.pin).toBe('5678');
  });

  it('findet den zugeordneten aktiven Einsatz eines Fahrzeugs', () => {
    const vehicle = { id: 7, game_vehicle_id: '1_HLF_1', name: '1-HLF-1', type: 'HLF', modes: null, x: 120, y: -40, status: 4, assigned_player_id: null };
    const event = { id: 1030, game_event_id: '30', name: 'Verkehrsunfall', x: 130, y: -50, status: 'active' as const, created_by: 'game' as const };
    app.vehicles = [vehicle];
    app.events = [event];
    app.assignments = [{ event_id: event.id, vehicle_id: vehicle.id }];

    expect(assignedEventForVehicle(vehicle.id)).toEqual(event);
  });

  it('liefert für ein Fahrzeug ohne aktiven Einsatz keinen Treffer', () => {
    const vehicle = { id: 8, game_vehicle_id: '2_RTW_A', name: '2-RTW-A', type: 'RTW', modes: null, x: 220, y: -90, status: 2, assigned_player_id: null };

    expect(assignedEventForVehicle(vehicle.id)).toBeUndefined();
  });

  it('hält Vormerkungen am geöffneten Einsatz und leert sie beim Einsatzwechsel', () => {
    const first = { id: 1, game_event_id: '1', name: 'Türöffnung', x: 10, y: 20, status: 'active' as const, created_by: 'game' as const };
    const second = { ...first, id: 2, game_event_id: '2', name: 'Brandmeldeanlage' };

    openAssign(first);
    toggleDispatchVehicle(11);
    toggleDispatchVehicle(12);
    expect(app.dispatchVehicleIds).toEqual([11, 12]);

    toggleDispatchVehicle(11);
    expect(app.dispatchVehicleIds).toEqual([12]);

    openAssign(second);
    expect(app.dispatchVehicleIds).toEqual([]);
  });
});
