import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import type { Vehicle } from '../lib/types';
import AssignModal from './AssignModal.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn(), refreshState: vi.fn() }));

vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../lib/polling', () => ({ refreshState: mocks.refreshState }));

const vehicle: Vehicle = {
  id: 1,
  game_vehicle_id: '1_HLF_1',
  name: '1-HLF-1',
  type: 'HLF',
  modes: 'Sondersignal,Still',
  x: 100,
  y: -100,
  status: 2,
  assigned_player_id: null,
};

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.connected = true;
  app.lastSuccessfulSync = Date.now();
  app.vehicles = [vehicle];
  app.players = [{ id: 1, player_id: 'one', name: 'Spieler Eins' }];
  app.assignEvent = {
    id: 101,
    game_event_id: 'event-101',
    name: 'Wohnungsbrand',
    x: 110,
    y: -110,
    status: 'active',
    created_by: 'game',
  };
  mocks.api.mockImplementation(async (action: string) => {
    if (action === 'state') return { vehicles: app.vehicles, assignments: app.assignments };
    if (action === 'events_get_vehicles') return { vehicles: [] };
    if (action === 'events_get_note') return { notes: [{ id: 1, event_id: 101, content: 'Bewohner vermisst' }] };
    if (action === 'events_get_logs') return { logs: [] };
    return { ok: true };
  });
});

afterEach(() => cleanup());

describe('Alarmierungsdialog', () => {
  it('alarmiert nicht mit Enter in der Spielerauswahl', async () => {
    const user = userEvent.setup();
    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /1-HLF-1/ }));
    const player = screen.getByRole('combobox', { name: 'Spieler' });
    player.focus();
    await user.keyboard('{Enter}');
    expect(mocks.api.mock.calls.some(([action]) => action === 'events_assign')).toBe(false);

    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(mocks.api.mock.calls.some(([action]) => action === 'events_assign')).toBe(true));
  });

  it('behält Ausrückmodus und Optionen während eines Polling-Takts', async () => {
    const user = userEvent.setup();
    render(AssignModal);
    const mode = await screen.findByRole('combobox', { name: /Ausrückmodus für 1-HLF-1/ });
    await user.selectOptions(mode, 'Still');
    mode.focus();

    app.vehicles = [{ ...vehicle, status: 1, modes: 'Sondersignal,Still,Ohne Signal' }];
    app.players = [{ id: 2, player_id: 'two', name: 'Spieler Zwei' }];
    app.events = [{ ...app.assignEvent!, name: 'Wohnungsbrand – aktualisiert' }];
    await tick();

    expect(screen.getByRole('combobox', { name: /Ausrückmodus für 1-HLF-1/ })).toBe(mode);
    expect(document.activeElement).toBe(mode);
    expect((mode as HTMLSelectElement).value).toBe('Still');
    expect(Array.from((mode as HTMLSelectElement).options, (option) => option.value)).toEqual(['Sondersignal', 'Still']);
  });

  it('speichert auch eine vollständig geleerte Notiz', async () => {
    const user = userEvent.setup();
    render(AssignModal);
    const notes = await screen.findByPlaceholderText('Einsatznotizen …');
    await waitFor(() => expect((notes as HTMLTextAreaElement).value).toBe('Bewohner vermisst'));
    await user.clear(notes);
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith('events_set_note', { event_id: 101, content: '' });
    });
  });

  it('sortiert Fahrzeuge bei nahezu gleicher Distanz nach Einsatzwert', async () => {
    const atDistance = (id: number, type: string, distance: number): Vehicle => ({
      ...vehicle,
      id,
      game_vehicle_id: `1_${type}_1`,
      name: type,
      modes: null,
      x: Number(app.assignEvent!.x) + distance * 10,
      y: Number(app.assignEvent!.y),
    });
    app.vehicles = [
      atDistance(1, 'RTW', 0),
      atDistance(2, 'NEF', 10),
      atDistance(3, 'KRAN', 20),
      atDistance(4, 'GWRH', 30),
      atDistance(5, 'AB', 40),
      atDistance(6, 'KLAF', 50),
      atDistance(7, 'GWL', 60),
      atDistance(8, 'TMF', 70),
      atDistance(9, 'DLK', 80),
      atDistance(10, 'HLF', 90),
      atDistance(11, 'ELW', 95),
      atDistance(12, 'KDOW', 100),
    ];

    render(AssignModal);
    await screen.findByText('Wache 1');

    const names = Array.from(document.querySelectorAll<HTMLElement>('.groups .veh .name'), (node) => node.textContent);
    expect(names).toEqual(['KDOW', 'ELW', 'HLF', 'TMF', 'DLK', 'KLAF', 'GWL', 'AB', 'KRAN', 'GWRH', 'NEF', 'RTW']);
  });

  it('bevorzugt bei deutlich verschiedener Distanz das naehere Fahrzeug', async () => {
    app.vehicles = [
      { ...vehicle, id: 1, game_vehicle_id: '1_KDOW_1', name: 'KDOW', modes: null, x: 2110, y: -110 },
      { ...vehicle, id: 2, game_vehicle_id: '1_RTW_1', name: 'RTW', modes: null, x: 110, y: -110 },
    ];

    render(AssignModal);
    await screen.findByText('Wache 1');

    const names = Array.from(document.querySelectorAll<HTMLElement>('.groups .veh .name'), (node) => node.textContent);
    expect(names).toEqual(['RTW', 'KDOW']);
  });

  it('schaltet per Klick von Entfernung auf die feste Fahrzeugfolge um', async () => {
    const user = userEvent.setup();
    app.vehicles = [
      { ...vehicle, id: 1, game_vehicle_id: '1_KDOW_1', name: 'KDOW', modes: null, x: 2110, y: -110 },
      { ...vehicle, id: 2, game_vehicle_id: '1_RTW_1', name: 'RTW', modes: null, x: 110, y: -110 },
    ];

    render(AssignModal);
    await screen.findByText('Wache 1');
    await user.click(screen.getByRole('button', { name: 'Entfernung' }));

    const names = Array.from(document.querySelectorAll<HTMLElement>('.groups .veh .name'), (node) => node.textContent);
    expect(names).toEqual(['KDOW', 'RTW']);
    expect(screen.getByRole('button', { name: 'Fahrzeugfolge' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('ordnet bei kleinen Distanzunterschieden Kennung 1 vor 2 und A vor B', async () => {
    app.vehicles = [
      { ...vehicle, id: 1, game_vehicle_id: '1_HLF_2', name: '1-HLF-2', modes: null, x: 110, y: -110 },
      { ...vehicle, id: 2, game_vehicle_id: '1_HLF_1', name: '1-HLF-1', modes: null, x: 610, y: -110 },
      { ...vehicle, id: 3, game_vehicle_id: '72_RTW_B', name: '72-RTW-B', type: 'RTW', modes: null, x: 210, y: -110 },
      { ...vehicle, id: 4, game_vehicle_id: '72_RTW_A', name: '72-RTW-A', type: 'RTW', modes: null, x: 710, y: -110 },
    ];

    render(AssignModal);
    await screen.findByText('Wache 1');

    const names = Array.from(document.querySelectorAll<HTMLElement>('.groups .veh .name'), (node) => node.textContent);
    expect(names).toEqual(['1-HLF-1', '1-HLF-2', '72-RTW-A', '72-RTW-B']);
  });

  it('zeigt fuer weitere Einheiten keinen Status an', async () => {
    app.vehicles = [
      {
        ...vehicle,
        id: 2,
        game_vehicle_id: 'TD',
        name: 'Stadtwerke',
        type: 'TD',
      },
    ];

    render(AssignModal);

    const checkbox = await screen.findByRole('checkbox', { name: /Stadtwerke/ });
    expect(checkbox.closest('.veh')?.querySelector('.status-badge')).toBeNull();
  });

  it('alarmiert weitere Einheiten unabhaengig von Status und Zuordnung', async () => {
    const user = userEvent.setup();
    const abschleppwagen = {
      ...vehicle,
      id: 2,
      game_vehicle_id: 'ASF',
      name: 'Abschleppwagen',
      type: 'ASF',
    };
    app.vehicles = [abschleppwagen];

    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /Abschleppwagen/ }));

    app.vehicles = [{ ...abschleppwagen, status: 0 }];
    app.assignments = [{ event_id: 999, vehicle_id: 2 }];
    await user.click(screen.getByRole('button', { name: /Alarmieren/ }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        'events_assign',
        expect.objectContaining({ event_id: 101, vehicle_ids: [2] }),
      );
    });
  });

  it('wartet bei einem Leitstellen-Einsatz auf die Bestaetigung aus dem Spiel', async () => {
    const user = userEvent.setup();
    app.assignEvent = {
      ...app.assignEvent!,
      game_event_id: null,
      created_by: 'frontend',
    };

    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /1-HLF-1/ }));

    expect(screen.getByText(/wird noch ans Spiel übertragen/)).toBeTruthy();
    const alarmButton = screen.getByRole('button', { name: /Alarmieren/ });
    expect(alarmButton.hasAttribute('disabled')).toBe(true);

    app.events = [{ ...app.assignEvent!, game_event_id: 'event-101' }];
    await waitFor(() => expect(alarmButton.hasAttribute('disabled')).toBe(false));
  });

  it('erlaubt Leitstellen-Einsaetze ohne Spieler', async () => {
    const user = userEvent.setup();
    app.assignEvent = {
      ...app.assignEvent!,
      game_event_id: 'event-101',
      created_by: 'frontend',
    };

    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /1-HLF-1/ }));

    const alarmButton = screen.getByRole('button', { name: /Alarmieren/ });
    expect(alarmButton.hasAttribute('disabled')).toBe(false);
    await user.click(alarmButton);

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        'events_assign',
        expect.objectContaining({ event_id: 101, player_id: null, vehicle_ids: [1] }),
      );
    });
  });

  it('prüft den Fahrzeugstatus unmittelbar vor der Alarmierung erneut', async () => {
    const user = userEvent.setup();
    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /1-HLF-1/ }));

    app.vehicles = [{ ...vehicle, status: 0 }];
    await user.click(screen.getByRole('button', { name: /Alarmieren/ }));

    await waitFor(() => expect(screen.getByText(/inzwischen alarmiert oder nicht mehr verfügbar/)).toBeTruthy());
    expect(mocks.api.mock.calls.some(([action]) => action === 'events_assign')).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /1-HLF-1/ })).toBeNull();
  });

  it('alarmiert Status 1 trotz einer veralteten internen Zuordnung', async () => {
    const user = userEvent.setup();
    app.vehicles = [{ ...vehicle, status: 1 }];
    app.assignments = [{ event_id: 999, vehicle_id: 1 }];

    render(AssignModal);
    await user.click(await screen.findByRole('checkbox', { name: /1-HLF-1/ }));
    await user.click(screen.getByRole('button', { name: /Alarmieren/ }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        'events_assign',
        expect.objectContaining({ event_id: 101, vehicle_ids: [1] }),
      );
    });
  });
});
