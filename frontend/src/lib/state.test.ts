import { beforeEach, describe, expect, it } from 'vitest';
import { app, initSettings, resetSessionData } from './state.svelte';

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
});
