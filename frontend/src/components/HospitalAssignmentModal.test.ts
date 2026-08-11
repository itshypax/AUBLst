import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import HospitalAssignmentModal from './HospitalAssignmentModal.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn(), refreshState: vi.fn() }));

vi.mock('../lib/api', () => ({ api: mocks.api }));
vi.mock('../lib/polling', () => ({ refreshState: mocks.refreshState }));

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  app.vehicles = [{ id: 1, game_vehicle_id: '72_RTW_1', name: '72-RTW-1', type: 'RTW', modes: null, x: 0, y: 0, status: 7, assigned_player_id: null }];
  app.hospitals = [
    { id: 2, name: 'Hanseklinik', x: 3000, y: 4000, ward_total: 10, ward_available: 5, icu_total: 4, icu_available: 2 },
    { id: 3, name: 'Uniklinik', x: 10000, y: 0, ward_total: 12, ward_available: 6, icu_total: 6, icu_available: 3 },
  ];
  app.hospitalReservations = [{
    id: 9,
    vehicle_id: 1,
    hospital_id: 2,
    bed_type: 'ward',
    status: 'reserved',
    created_at: '2026-08-09 12:00:00',
    updated_at: '2026-08-09 12:00:00',
    arrived_at: null,
    game_vehicle_id: '72_RTW_1',
    vehicle_name: '72-RTW-1',
    hospital_name: 'Hanseklinik',
  }];
  app.hospitalAssignmentVehicleId = 1;
  mocks.api.mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

describe('Klinikzuweisung', () => {
  it('zeigt alle Entfernungen und hebt die nächste Klinik hervor', () => {
    render(HospitalAssignmentModal);

    const nearest = screen.getByText('500 m · Luftlinie (Fallback)');
    expect(nearest.classList.contains('nearest')).toBe(true);
    expect(screen.getByText('1,0 km · Luftlinie (Fallback)').classList.contains('nearest')).toBe(false);
  });

  it('kann eine bestehende Zuweisung nachträglich aufheben', async () => {
    const user = userEvent.setup();
    render(HospitalAssignmentModal);

    expect(screen.getByRole('heading', { name: 'Klinikzuweisung ändern' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zuweisung aufheben' }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('hospital_reservation_clear', { vehicle_id: 1 }));
  });
});
