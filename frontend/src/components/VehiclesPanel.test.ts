import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import type { Vehicle } from '../lib/types';
import VehiclesPanel from './VehiclesPanel.svelte';

function transport(id: number, suffix: string): Vehicle {
  return { id, game_vehicle_id: `72_RTW_${suffix}`, name: `72-RTW-${suffix}`, type: 'RTW', modes: null, x: 0, y: 0, status: 7, assigned_player_id: null };
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
