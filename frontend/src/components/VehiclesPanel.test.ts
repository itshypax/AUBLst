import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import type { Vehicle } from '../lib/types';
import VehiclesPanel from './VehiclesPanel.svelte';

function transport(id: number, suffix: string): Vehicle {
  return { id, game_vehicle_id: `72_RTW_${suffix}`, name: `72-RTW-${suffix}`, type: 'RTW', modes: null, x: 0, y: 0, status: 7, assigned_player_id: null };
}

function fireVehicle(id: number, station: number, type: string, status = 1): Vehicle {
  return { id, game_vehicle_id: `${station}_${type}_${id}`, name: `${type} ${id}`, type, modes: null, x: 0, y: 0, status, assigned_player_id: null };
}

beforeEach(() => {
  resetSessionData();
  app.vehicles = [transport(1, 'A'), transport(2, 'B')];
  app.hospitalReservations = [
    { id: 1, vehicle_id: 1, hospital_id: 1, bed_type: 'ward', status: 'reserved', created_at: '', updated_at: '', arrived_at: null, game_vehicle_id: '72_RTW_A', vehicle_name: '72-RTW-A', hospital_name: 'Uniklinik' },
    { id: 2, vehicle_id: 2, hospital_id: 2, bed_type: 'icu', status: 'reserved', created_at: '', updated_at: '', arrived_at: null, game_vehicle_id: '72_RTW_B', vehicle_name: '72-RTW-B', hospital_name: 'Krankenhaus Berg' },
  ];
});

afterEach(() => cleanup());

describe('Klinikziele in der Fahrzeugübersicht', () => {
  it('bietet Fahrzeugaktionen nicht mehr über einen Drei-Punkte-Knopf an', async () => {
    const user = userEvent.setup();
    render(VehiclesPanel);
    await user.click(screen.getByRole('tab', { name: /Rettungsdienst/ }));

    expect(screen.queryByRole('button', { name: /Aktionen für/ })).toBeNull();
  });

  it('zeigt Normaltransporte blau ohne Zusatz und Intensivtransporte rot', async () => {
    const user = userEvent.setup();
    render(VehiclesPanel);
    await user.click(screen.getByRole('tab', { name: /Rettungsdienst/ }));

    const normal = screen.getByText('→ Uniklinik');
    const intensive = screen.getByText('→ Krankenhaus Berg · Intensiv');
    expect(normal.classList.contains('intensive')).toBe(false);
    expect(intensive.classList.contains('intensive')).toBe(true);
    expect(normal.closest('.vehicle-label')?.getAttribute('data-tooltip')).toContain('Ziel: Uniklinik');
    expect(normal.closest('.vehicle-label')?.getAttribute('data-tooltip')).not.toContain('Normal');
    expect(intensive.closest('.vehicle-label')?.getAttribute('data-tooltip')).toContain('Ziel: Berg · Intensiv');
  });

  it('zeigt das Ziel in Status 8 und entfernt es ab Status 1', async () => {
    const user = userEvent.setup();
    app.vehicles = [{ ...transport(1, 'A'), status: 8 }];
    app.hospitalReservations = [{ ...app.hospitalReservations[0], status: 'arrived', arrived_at: '2026-08-09 12:05:00' }];

    render(VehiclesPanel);
    await user.click(screen.getByRole('tab', { name: /Rettungsdienst/ }));

    expect(screen.getByText('→ Uniklinik')).toBeTruthy();

    app.vehicles = [{ ...transport(1, 'A'), status: 1 }];
    await waitFor(() => expect(screen.queryByText(/→ Uniklinik/)).toBeNull());
    expect(screen.getByText('72-RTW-A').closest('.vehicle-label')?.getAttribute('data-tooltip')).not.toContain('Ziel:');
  });
});

describe('Zugalarm in der Fahrzeugübersicht', () => {
  it('erscheint an den Hauptwachen nur bei einem offenen Einsatz', async () => {
    app.vehicles = [fireVehicle(1, 1, 'HLF'), fireVehicle(2, 2, 'HLF')];
    render(VehiclesPanel);

    expect(screen.queryByRole('button', { name: /Zugalarm Wache/ })).toBeNull();

    app.assignEvent = { id: 101, game_event_id: '101', name: 'Brand', x: 0, y: 0, status: 'active', created_by: 'game' };

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zugalarm Wache 1 für Einsatz 101 vormerken' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Zugalarm Wache 2 für Einsatz 101 vormerken' })).toBeTruthy();
    });
  });

  it('merkt die verfügbaren Zugfahrzeuge der Wache vor', async () => {
    const user = userEvent.setup();
    app.vehicles = [
      fireVehicle(1, 1, 'HLF'),
      fireVehicle(2, 1, 'DLK'),
      fireVehicle(3, 1, 'ELW'),
      fireVehicle(4, 1, 'TLF'),
      fireVehicle(5, 1, 'LF', 3),
    ];
    app.assignEvent = { id: 101, game_event_id: '101', name: 'Brand', x: 0, y: 0, status: 'active', created_by: 'game' };
    app.dispatchVehicleIds = [99];
    render(VehiclesPanel);

    await user.click(screen.getByRole('button', { name: 'Zugalarm Wache 1 für Einsatz 101 vormerken' }));

    expect(app.dispatchVehicleIds).toEqual([99, 1, 2, 3, 4]);
  });
});
