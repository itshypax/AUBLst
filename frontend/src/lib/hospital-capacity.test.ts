import { describe, expect, it } from 'vitest';
import { compareHospitalNames, hospitalCapacityLabel, hospitalCapacityLevel } from './hospital-capacity';

describe('Klinikkapazität', () => {
  it('stuft 0 rot, 1 bis 2 gelb und ab 3 grün ein', () => {
    expect(hospitalCapacityLevel(0)).toBe('full');
    expect(hospitalCapacityLevel(1)).toBe('low');
    expect(hospitalCapacityLevel(2)).toBe('low');
    expect(hospitalCapacityLevel(3)).toBe('ok');
  });

  it('liefert Beschriftungen ohne Bettenzahl', () => {
    expect(hospitalCapacityLabel('full')).toBe('belegt');
    expect(hospitalCapacityLabel('low')).toBe('knapp');
    expect(hospitalCapacityLabel('ok')).toBe('verfügbar');
  });

  it('ordnet die Auenburger Kliniken in der festen Reihenfolge', () => {
    const names = ['Lichtenau', 'Berg', 'Hanseklinik', 'Uniklinik', 'Auenklinik'];
    expect(names.sort(compareHospitalNames)).toEqual(['Uniklinik', 'Hanseklinik', 'Berg', 'Lichtenau', 'Auenklinik']);
  });
});
