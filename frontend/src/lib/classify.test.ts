import { describe, expect, it } from 'vitest';
import type { Vehicle } from './types';
import { alarmGroups, alarmVehicleCount, eventCategory, hasLoeschzug, isHospitalTransportUnit, sortVehiclesByAlarmPriority, stationColumnsMixed, vehicleDisplayName, vehicleDisplayNameForIdentifier, vehicleTypeLabel } from './classify';

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
  it('zeigt das interne BSW-Kürzel als Bestattungswagen an', () => {
    expect(vehicleDisplayName({ ...vehicle(1, 'BSW'), game_vehicle_id: 'BSW', name: 'Bestatter' })).toBe('Bestattungswagen');
  });

  it('löst technische Kennungen für sichtbare Texte zum Fahrzeugnamen auf', () => {
    const kdow = { ...vehicle(1, 'KDOW'), game_vehicle_id: '1_KDOW_1', name: '1-KDOW-1' };
    expect(vehicleDisplayNameForIdentifier('1_KDOW_1', [kdow])).toBe('1-KDOW-1');
    expect(vehicleDisplayNameForIdentifier('1-KDOW-1', [kdow])).toBe('1-KDOW-1');
    expect(vehicleDisplayNameForIdentifier('unbekannt', [kdow])).toBe('unbekannt');
  });

  it('blendet numerische Typklassen aus', () => {
    expect(vehicleTypeLabel({ ...vehicle(1, 'RTW'), type: '24' })).toBe('');
    expect(vehicleTypeLabel({ ...vehicle(2, 'RTW'), type: 'None' })).toBe('');
    expect(vehicleTypeLabel({ ...vehicle(2, 'RTW'), type: 'RTW' })).toBe('RTW');
  });

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

  it('bietet für Feuerwehr extern keinen Löschzug an', () => {
    const externalHlf = { ...vehicle(20, 'HLF'), game_vehicle_id: '11_HLF_1' };
    const externalGroup = alarmGroups([externalHlf]).find((group) => group.key === 'fw-extern');

    expect(externalGroup?.label).toBe('Feuerwehr extern');
    expect(externalGroup && hasLoeschzug(externalGroup)).toBe(false);
  });

  it('zählt den Zahlenmodus nicht getrackter Einheiten als Fahrzeuganzahl', () => {
    const asf = { ...vehicle(21, 'ASF'), game_vehicle_id: 'ASF', modes: '1,2,3,4,Masterlift,Tieflader' };
    const police = { ...vehicle(22, 'FUSTW'), game_vehicle_id: 'FuSTW', modes: '1,2,3' };
    const utilities = { ...vehicle(23, 'TD'), game_vehicle_id: 'TD', modes: null };

    expect(alarmVehicleCount(asf, '3')).toBe(3);
    expect(alarmVehicleCount(police, '2')).toBe(2);
    expect(alarmVehicleCount(asf, 'Masterlift')).toBe(1);
    expect(alarmVehicleCount(utilities)).toBe(1);
  });
});

describe('Fahrzeugliste ohne Tabtrennung', () => {
  function unit(id: number, gameId: string): Vehicle {
    return { ...vehicle(id, gameId.split('_')[1] ?? gameId), game_vehicle_id: gameId, name: gameId };
  }

  it('stellt je Wache erst Feuerwehr, dann Rettungsdienst in vier Spalten', () => {
    const columns = stationColumnsMixed([
      unit(1, '1_HLF_1'),
      unit(2, '1_RTW_A'),
      unit(3, '11_LF_1'),
      unit(4, 'CHRISTOPH_82'),
      unit(5, '2_HLF_1'),
      unit(6, '72_RTW_A'),
      unit(7, '4_TLF_1'),
      unit(8, '0_FLB_1'),
      unit(9, '74_RTW_A'),
      unit(10, '3_HLF_1'),
    ]);

    const describe = (column: { label: string; tab?: string }[]) => column.map((group) => `${group.label}/${group.tab}`);
    expect(columns).toHaveLength(4);
    expect(describe(columns[0])).toEqual(['Wache 1/fire', 'Wache 1/rescue', 'Wache 11/fire', 'Hubschrauber/rescue']);
    expect(describe(columns[1])).toEqual(['Wache 2/fire', 'Rettungswache 72/rescue']);
    expect(describe(columns[2])).toEqual(['Wache 3/fire']);
    expect(describe(columns[3])).toEqual(['Wache 4/fire', 'Feuerwehrboote/fire', 'Rettungswache 74/rescue']);
  });

  it('hängt unbekannte Wachen in der letzten Spalte an', () => {
    const columns = stationColumnsMixed([unit(1, 'STADTWERKE_1'), unit(2, '1_HLF_1')]);
    expect(columns[3].map((group) => group.label)).toEqual(['Weitere']);
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

// Alle Stichworte der AUBMP-Mod (Strings/CallManager.xml plus Lang/de/supervevents.xml),
// Zuordnung abgestimmt am 9. September 2026. Titel kommen ohne Umlaute aus dem Spiel.
describe('AUBMP-Einsatzkatalog', () => {
  const catalog: [string, ReturnType<typeof eventCategory>][] = [
    ['Kleinbrand', 'fire'],
    ['Brennt Unterstand', 'fire'],
    ['Gebaeudebrand', 'fire'],
    ['Gebaeudebrand Menschenleben in Gefahr', 'fire'],
    ['Waldbrand', 'fire'],
    ['Feuer - unklare Lage', 'fire'],
    ['Unklare Rauchentwicklung', 'fire'],
    ['Fahrzeugbrand', 'fire'],
    ['Brennt Motorrad', 'fire'],
    ['Muellverbrennung', 'fire'],
    ['Vegetationsbrand', 'fire'],
    ['Dachstuhlbrand', 'fire'],
    ['Schuppenbrand', 'fire'],
    ['Brennt Lagerhalle', 'fire'],
    ['Garagenbrand', 'fire'],
    ['Rauch aus Container', 'fire'],
    ['Brennt Altkleidercontainer', 'fire'],
    ['Muelltonnenbrand', 'fire'],
    ['Brennt Reisebus', 'fire'],
    ['Brennt Wasserfahrzeug', 'fire'],
    ['Fettexplosion', 'fire'],
    ['Heimrauchmelder', 'fire'],
    ['Brandmeldeanlage', 'fire'],
    ['Betriebsstoffe auslaufend', 'thl'],
    ['Auffahrunfall', 'thl'],
    ['Verkehrsunfall Person eingeschlossen', 'thl'],
    ['Verkehrsunfall mehrere Fahrzeuge', 'thl'],
    ['Verkehrsunfall Grossfahrzeug', 'thl'],
    ['Oelspur', 'thl'],
    ['Verkehrsunfall unklare Lage', 'thl'],
    ['Verkehrsunfall E-CALL', 'thl'],
    ['LKW Brennt', 'fire'],
    ['Verkehrsunfall Fahrzeug im Wasser', 'water'],
    ['Explosion', 'thl'],
    ['Wildunfall', 'thl'],
    ['Tier in Wasser', 'water'],
    ['Unfall mit Strassenbahn', 'thl'],
    ['Strassenbahn entgleist', 'thl'],
    ['Brennt Strassenbahn', 'fire'],
    ['Verkehrsunfall Bus', 'thl'],
    ['Person unter Fahrzeug', 'thl'],
    ['Ueberlandhilfe DLK', 'thl'],
    ['Luftnotlage Flughafen', 'thl'],
    ['Anforderung GW-SAN', 'medical'],
    ['Unklarer Stoffaustritt', 'hazard'],
    ['Gefahrguttransport Stoffaustritt', 'hazard'],
    ['Unfall Gefahrgut', 'hazard'],
    ['VU Zug gegen Pkw', 'thl'],
    ['Brennt Lok', 'fire'],
    ['Unfall Luftfahrzeug', 'thl'],
    ['Absturz Luftfahrzeug', 'thl'],
    ['Unbekanntes Flugobjekt', 'other'],
    ['Absturzmeldung Flugsicherung', 'thl'],
    ['Boot in Not', 'water'],
    ['Ast im Baum', 'thl'],
    ['Sturmschaden', 'thl'],
    ['Katze im Baum', 'thl'],
    ['Weltkriegsbombe gefunden', 'thl'],
    ['Keller unter Wasser', 'water'],
    ['Person in Aufzug', 'thl'],
    ['Objekte fallen vom Dach', 'thl'],
    ['Schornsteinbrand', 'fire'],
    ['Strasse unter Wasser', 'thl'],
    ['Gasleitung angebaggert', 'thl'],
    ['Kampfstoffe gefunden', 'thl'],
    ['Schwanenrettung', 'thl'],
    ['Kind in Klettergeruest', 'thl'],
    ['Hund in Klettergeruest', 'thl'],
    ['Tierrettung Wasser', 'water'],
    ['Amtshilfe Beweissicherung aus Fluss', 'water'],
    ['Gewaesserverunreinigung', 'water'],
    ['Person gestuerzt', 'medical'],
    ['Person in Not', 'medical'],
    ['Herzinfarkt', 'medical'],
    ['Betrunkene Person', 'medical'],
    ['Krankentransport', 'medical'],
    ['Person in Notlage auf Wasser', 'water'],
    ['Tueroeffnung', 'thl'],
    ['Person vermisst', 'medical'],
    ['Arbeitsunfall', 'thl'],
    ['Fallschirmspringer abgestuerzt', 'thl'],
    ['ManV unklare Lage', 'medical'],
    ['Chlorgasaustritt ManV', 'hazard'],
    ['Verdacht Infektionskrankheit', 'medical'],
    ['Unklares Infektionsgeschehen', 'medical'],
    ['Baugeruest Eingestuerzt', 'thl'],
    ['Notfallverlegung', 'medical'],
    ['Anforderung Drehleiter', 'thl'],
    ['Klimaanlage in Reisebus kaputt', 'medical'],
    ['Hoehenrettung', 'thl'],
    ['Schwanenangriff', 'thl'],
    ['Reizgasangriff', 'medical'],
    ['Klimaanlage in Zug kaputt', 'medical'],
    ['Koerperverletzung', 'other'],
    ['Randalierer', 'other'],
    ['Schlaegerei', 'other'],
    ['Sachbeschaedigung', 'other'],
    ['Raubueberfall', 'other'],
    ['Ruhestoerung', 'other'],
    ['Taschendiebstahl', 'other'],
    ['Ladendiebstahl', 'other'],
    ['Geldtransporter ueberfallen', 'other'],
    ['Haftbefehl', 'other'],
    ['Haftbefehl Gefahrenlage', 'other'],
    ['Hausdurchsuchung', 'other'],
    ['Hauseinbruch', 'other'],
    ['Herrenloses Gepaeckstueck', 'other'],
    ['Geldautomat gesprengt', 'other'],
    ['Geldautomat manipuliert', 'other'],
    ['Randalierer/Sachbeschaedigung', 'other'],
    ['Haeuslicher Streit', 'other'],
    ['Fahrzeug gestohlen', 'other'],
    ['Loewe gesichtet', 'other'],
    ['Kampfhund greift Person an', 'other'],
    ['Wilderei', 'other'],
    ['Bankueberfall', 'other'],
    ['Ueberfallalarm Ladengeschaeft', 'other'],
    ['Ueberfallalarm Bank', 'other'],
    ['Alarmanlage ausgeloest', 'other'],
    ['Drogendealer', 'other'],
    ['Angemeldete Demonstration', 'other'],
    ['Unangemeldete Versammlung', 'other'],
    ['Kundgebung', 'other'],
    ['Sanitaetsdienst Volksfest', 'medical'],
    ['Sanitaetsdienst Fussballspiel', 'medical'],
    ['Unwetterwarnung STURM', 'info'],
    ['Unwetterwarnung HITZE', 'info'],
    ['INFO Feuerwerk', 'info'],
  ];

  it.each(catalog)('ordnet "%s" der Kategorie %s zu', (title, expected) => {
    expect(eventCategory(title)).toBe(expected);
  });

  it('erkennt Info-Meldungen auch mit Umlauten und Kleinschreibung', () => {
    expect(eventCategory('Info Feuerwerk')).toBe('info');
    expect(eventCategory('Unwetterwarnung Glätte')).toBe('info');
    expect(eventCategory('Fettexplosion')).toBe('fire');
  });
});
