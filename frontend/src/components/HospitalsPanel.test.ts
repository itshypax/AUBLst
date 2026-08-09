import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import type { Vehicle } from '../lib/types';
import HospitalsPanel from './HospitalsPanel.svelte';

const hospital = (id: number, name: string) => ({
  id,
  name,
  x: 0,
  y: 0,
  icu_total: 4,
  icu_available: 2,
  ward_total: 10,
  ward_available: 5,
});

beforeEach(() => {
  resetSessionData();
  app.hospitals = [
    hospital(1, 'Uniklinik'),
    hospital(2, 'Hanseklinik'),
    hospital(3, 'Berg'),
    hospital(4, 'Lichtenau'),
  ];
});

afterEach(() => cleanup());

describe('Krankenhäuser', () => {
  it('zeigt Richtung und Kartenlage passend zum Krankenhaus', () => {
    render(HospitalsPanel);

    const expected = [
      ['Uniklinik', 'Nordwest', true],
      ['Hanseklinik', 'Südost', true],
      ['Berg', 'West', false],
      ['Lichtenau', 'Ost', false],
    ] as const;

    for (const [name, direction, onMap] of expected) {
      const row = screen.getByText(name).closest('.hospital');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(direction)).toBeTruthy();
      expect(within(row as HTMLElement).queryByLabelText('Auf der Karte') !== null).toBe(onMap);
    }
  });

  it('zieht vorgemerkte Betten sichtbar vom gemeldeten Bestand ab', () => {
    app.hospitalReservations = [{
      id: 1,
      vehicle_id: 77,
      hospital_id: 1,
      bed_type: 'ward',
      status: 'reserved',
      created_at: '2026-08-09 12:00:00',
      updated_at: '2026-08-09 12:00:00',
      arrived_at: null,
      game_vehicle_id: '72_RTW_1',
      vehicle_name: '72-RTW-1',
      hospital_name: 'Uniklinik',
    }];
    render(HospitalsPanel);

    const row = screen.getByText('Uniklinik').closest('.hospital') as HTMLElement;
    expect(within(row).getByText('4/10')).toBeTruthy();
    expect(row.querySelector('.reserved')).not.toBeNull();
  });

  it('ignoriert eine alte Ankunft, sobald das Fahrzeug wieder Status 1 hat', () => {
    app.vehicles = [{
      id: 77,
      game_vehicle_id: '74_RTW_B',
      name: '74-RTW-B',
      type: 'RTW',
      modes: null,
      x: 0,
      y: 0,
      status: 1,
      assigned_player_id: null,
    } satisfies Vehicle];
    app.hospitalReservations = [{
      id: 2,
      vehicle_id: 77,
      hospital_id: 1,
      bed_type: 'ward',
      status: 'arrived',
      created_at: '2026-08-09 12:00:00',
      updated_at: '2026-08-09 12:05:00',
      arrived_at: '2026-08-09 12:05:00',
      game_vehicle_id: '74_RTW_B',
      vehicle_name: '74-RTW-B',
      hospital_name: 'Uniklinik',
    }];
    render(HospitalsPanel);

    const row = screen.getByText('Uniklinik').closest('.hospital') as HTMLElement;
    expect(within(row).getByText('5/10')).toBeTruthy();
    expect(row.querySelector('.reserved')).toBeNull();
  });

  it('berücksichtigt eine noch nicht bestätigte Ankunft in Status 8', () => {
    app.vehicles = [{
      id: 77,
      game_vehicle_id: '74_RTW_B',
      name: '74-RTW-B',
      type: 'RTW',
      modes: null,
      x: 0,
      y: 0,
      status: 8,
      assigned_player_id: null,
    } satisfies Vehicle];
    app.hospitalReservations = [{
      id: 2,
      vehicle_id: 77,
      hospital_id: 1,
      bed_type: 'ward',
      status: 'arrived',
      created_at: '2026-08-09 12:00:00',
      updated_at: '2026-08-09 12:05:00',
      arrived_at: '2026-08-09 12:05:00',
      game_vehicle_id: '74_RTW_B',
      vehicle_name: '74-RTW-B',
      hospital_name: 'Uniklinik',
    }];
    render(HospitalsPanel);

    const row = screen.getByText('Uniklinik').closest('.hospital') as HTMLElement;
    expect(within(row).getByText('4/10')).toBeTruthy();
    expect(row.querySelector('.reserved')).not.toBeNull();
  });
});
