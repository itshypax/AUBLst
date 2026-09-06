import { describe, expect, it } from 'vitest';
import {
  additionalVehiclesAssignedToEvent,
  assignmentModes,
  isMonitorStation,
  monitorEvents,
  monitorStationsLabel,
  monitorVehicles,
  parseMonitorStations,
  serializeMonitorStations,
  tickerText,
  vehiclesAssignedToEvent,
} from './alarm-monitor';
import type { Assignment, EventItem, Vehicle } from './types';

const vehicles: Vehicle[] = [
  {
    id: 1,
    game_vehicle_id: '1_HLF_1',
    name: '1-HLF-1',
    type: 'HLF',
    modes: null,
    x: 10,
    y: -20,
    status: 4,
    assigned_player_id: null,
  },
  {
    id: 2,
    game_vehicle_id: '1_ELW_1',
    name: '1-ELW-1',
    type: 'ELW',
    modes: null,
    x: 20,
    y: -30,
    status: 3,
    assigned_player_id: null,
  },
  {
    id: 3,
    game_vehicle_id: '2_HLF_1',
    name: '2-HLF-1',
    type: 'HLF',
    modes: null,
    x: 30,
    y: -40,
    status: 2,
    assigned_player_id: null,
  },
  {
    id: 4,
    game_vehicle_id: 'FUSTW',
    name: 'Streifenwagen',
    type: 'FUSTW',
    modes: null,
    x: -1000000,
    y: -1000000,
    status: 4,
    assigned_player_id: null,
  },
];

const events: EventItem[] = [
  {
    id: 10,
    game_event_id: '10',
    name: 'Wohnungsbrand',
    x: 100,
    y: -200,
    status: 'active',
    created_by: 'game',
    created_at: '2026-08-28 18:00:00',
  },
  {
    id: 11,
    game_event_id: '11',
    name: 'Verkehrsunfall',
    x: 200,
    y: -300,
    status: 'active',
    created_by: 'game',
    created_at: '2026-08-28 18:05:00',
  },
  {
    id: 12,
    game_event_id: '12',
    name: 'Alter Einsatz',
    x: 300,
    y: -400,
    status: 'completed',
    created_by: 'game',
    created_at: '2026-08-28 18:10:00',
  },
];

const assignments: Assignment[] = [
  { event_id: 10, vehicle_id: 1, alarm_modes: ['Sondersignal'] },
  { event_id: 11, vehicle_id: 2 },
  { event_id: 11, vehicle_id: 3 },
  { event_id: 11, vehicle_id: 4 },
  { event_id: 12, vehicle_id: 1 },
];

describe('Alarmmonitor', () => {
  it('akzeptiert die vier Hauptwachen und RD', () => {
    expect(isMonitorStation('1')).toBe(true);
    expect(isMonitorStation('4')).toBe(true);
    expect(isMonitorStation('RD')).toBe(true);
    expect(isMonitorStation('11')).toBe(false);
  });

  it('liest die Auswahl aus URL und Speicher, sortiert und ohne Doppelte', () => {
    expect(parseMonitorStations('1,4')).toEqual(['1', '4']);
    expect(parseMonitorStations('rd')).toEqual(['RD']);
    expect(parseMonitorStations('4, 1,1')).toEqual(['1', '4']);
    expect(parseMonitorStations('11')).toEqual([]);
    expect(parseMonitorStations(null)).toEqual([]);
    expect(serializeMonitorStations(['RD', '2'])).toBe('2,RD');
  });

  it('beschriftet die Auswahl', () => {
    expect(monitorStationsLabel(['1'])).toBe('Wache 1');
    expect(monitorStationsLabel(['1', '4'])).toBe('Wache 1 + 4');
    expect(monitorStationsLabel(['RD'])).toBe('RD');
    expect(monitorStationsLabel(['2', 'RD'])).toBe('Wache 2 + RD');
  });

  it('zeigt nur Fahrzeuge der gewählten Wache in Alarmreihenfolge', () => {
    expect(monitorVehicles(vehicles, ['1']).map((vehicle) => vehicle.id)).toEqual([2, 1]);
  });

  it('vereinigt mehrere Wachen und den Rettungsdienst ohne Doppelte', () => {
    const rescue = (id: number, gameId: string): Vehicle => ({
      id,
      game_vehicle_id: gameId,
      name: gameId.replaceAll('_', '-'),
      type: gameId.split('_')[1] ?? gameId,
      modes: null,
      x: 0,
      y: 0,
      status: 2,
      assigned_player_id: null,
    });
    const fleet = [...vehicles, rescue(5, '1_RTW_A'), rescue(6, '74_RTW_A'), rescue(7, 'CHRISTOPH_82')];

    expect(monitorVehicles(fleet, ['1', '2']).map((vehicle) => vehicle.id)).toEqual([2, 1, 3, 5]);
    expect(monitorVehicles(fleet, ['RD']).map((vehicle) => vehicle.id)).toEqual([7, 5, 6]);
    expect(monitorVehicles(fleet, ['1', 'RD']).map((vehicle) => vehicle.id)).toEqual([2, 1, 7, 5, 6]);
    expect(additionalVehiclesAssignedToEvent(fleet, assignments, 11, ['1', '2'])).toEqual([]);
  });

  it('ordnet einer Wache nur aktive Einsätze ihrer Fahrzeuge zu', () => {
    expect(monitorEvents(events, assignments, vehicles, ['1']).map((event) => event.id)).toEqual([11, 10]);
    expect(monitorEvents(events, assignments, vehicles, ['2']).map((event) => event.id)).toEqual([11]);
  });

  it('liefert alarmierte Wachfahrzeuge und ihre Alarmierungsart', () => {
    expect(vehiclesAssignedToEvent(vehicles, assignments, 10, ['1']).map((vehicle) => vehicle.id)).toEqual([1]);
    expect(assignmentModes(assignments, 10, 1)).toEqual(['Sondersignal']);
  });

  it('liefert reguläre mitalarmierte Fahrzeuge anderer Wachen getrennt', () => {
    expect(additionalVehiclesAssignedToEvent(vehicles, assignments, 11, ['1']).map((vehicle) => vehicle.id)).toEqual([3]);
  });

  it('baut den Laufbandtext aus den aktiven Lagemeldungen', () => {
    expect(
      tickerText([
        { message: 'Lage', long_message: 'Tramverkehr eingestellt' },
        { message: 'Alarmstufe 2', long_message: '' },
        { message: 'Lage', long_message: 'Tramverkehr eingestellt' },
        { message: '  ', long_message: null },
      ]),
    ).toBe('+++ Tramverkehr eingestellt +++ Alarmstufe 2 +++');
    expect(tickerText([])).toBe('');
  });
});
