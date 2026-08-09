import { describe, expect, it } from 'vitest';
import type { Vehicle } from './types';
import { eventCategory, isHospitalTransportUnit, sortVehiclesByAlarmPriority } from './classify';

function vehicle(id: number, type: string): Vehicle {
  return {
    id,
    game_vehicle_id: `1_${type}_${id}`,
    name: type,
    type,
    modes: null,
    x: 0,
    y: 0,
    status: 2,
    assigned_player_id: null,
  };
}

describe('Fahrzeuggruppierung', () => {
  it('erkennt RTW und ITW als Kliniktransporter', () => {
    expect(isHospitalTransportUnit(vehicle(1, 'RTW'))).toBe(true);
    expect(isHospitalTransportUnit(vehicle(2, 'ITW'))).toBe(true);
    expect(isHospitalTransportUnit(vehicle(3, 'NEF'))).toBe(false);
  });

  it('sortiert Fahrzeuge innerhalb einer Wache nach Einsatzwert', () => {
    const vehicles = [
      vehicle(1, 'RTW'),
      vehicle(2, 'NEF'),
      vehicle(3, 'KRAN'),
      vehicle(4, 'GWRH'),
      vehicle(5, 'KMB'),
      vehicle(6, 'AB'),
      vehicle(7, 'WLF'),
      vehicle(8, 'KLAF'),
      vehicle(9, 'GWL'),
      vehicle(10, 'TMF'),
      vehicle(11, 'DLK'),
      vehicle(12, 'HLF'),
      vehicle(13, 'ELW'),
      vehicle(14, 'KDOW'),
    ];

    expect(sortVehiclesByAlarmPriority(vehicles).map((item) => item.name)).toEqual([
      'KDOW',
      'ELW',
      'HLF',
      'DLK',
      'TMF',
      'GWL',
      'KLAF',
      'AB',
      'WLF',
      'GWRH',
      'KMB',
      'KRAN',
      'NEF',
      'RTW',
    ]);
  });
});

describe('Einsatzkategorien', () => {
  it('erkennt Wasserlagen und lässt einen Schiffsbrand ein Brandeinsatz bleiben', () => {
    expect(eventCategory('Gewässerverunreinigung im Hafen')).toBe('water');
    expect(eventCategory('Person im Wasser')).toBe('water');
    expect(eventCategory('Wasserrettung auf der Elbe')).toBe('water');
    expect(eventCategory('Schiffsbrand')).toBe('fire');
  });

  it('ordnet eine Straße unter Wasser der technischen Hilfe zu', () => {
    expect(eventCategory('Straße unter Wasser')).toBe('thl');
    expect(eventCategory('Strasse unter Wasser')).toBe('thl');
  });

  it('ordnet Personen im Aufzug der technischen Hilfe zu', () => {
    expect(eventCategory('Person in Aufzug')).toBe('thl');
    expect(eventCategory('Person im Fahrstuhl eingeschlossen')).toBe('thl');
  });

  it('ordnet Müllverbrennung einem Brandeinsatz zu', () => {
    expect(eventCategory('Müllverbrennung')).toBe('fire');
    expect(eventCategory('Muellverbrennung')).toBe('fire');
  });

  it('erkennt Gefahrguteinsätze', () => {
    expect(eventCategory('Unklarer Stoffaustritt')).toBe('hazard');
    expect(eventCategory('Gefahrgutunfall')).toBe('hazard');
    expect(eventCategory('Gasaustritt in Industrieanlage')).toBe('hazard');
  });

  it('erkennt gestürzte Personen als medizinischen Einsatz', () => {
    expect(eventCategory('Person gestürzt')).toBe('medical');
    expect(eventCategory('Person gestuerzt')).toBe('medical');
  });
});
