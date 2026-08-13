import type { Vehicle } from './types';

export type MainTab = 'fire' | 'rescue';

// Fahrzeug-IDs folgen dem Schema <Wache>_<Typ>_<Kennung>, z. B. 1_HLF_1 oder 72_RTW_A
const RESCUE_TYPES = new Set(['RTW', 'KTW', 'NKTW', 'GRTW', 'ITW', 'NEF', 'NAW', 'RTH', 'ITH', 'GWSAN', 'GWRH']);
const RESCUE_STATIONS = new Set(['72', '74', 'CHRISTOPH']);

// Einheiten ohne Kartenposition; alarmierbar, aber nicht in der Übersicht
const HIDDEN_IDS = new Set(['ASF', 'BSW', 'JA', 'FUSTW', 'TD']);

// Pseudo-Einheiten, deren Alarmierung eine Aktion auslöst (Sperrungen usw.)
const ACTION_PREFIX = 'FS_LST';

// Die Feuerwehrboote (Wache 0) hängen unter Wache 4
const FIRE_ORDER = ['1', '11', '2', '3', '31', '4', '0'];
const RESCUE_ORDER = ['1', 'CHRISTOPH', '2', '72', '3', '4', '74'];

const OTHER_KEY = '_other';

function idOf(v: Pick<Vehicle, 'game_vehicle_id'>): string {
  return (v.game_vehicle_id ?? '').toUpperCase();
}

function idParts(v: Vehicle): string[] {
  return idOf(v).split(/[_-]/).filter(Boolean);
}

export function station(v: Vehicle): string {
  return idParts(v)[0] ?? '';
}

export function typeToken(v: Vehicle): string {
  const parts = idParts(v);
  return parts[1] ?? parts[0] ?? '';
}

export function isHospitalTransportUnit(v: Vehicle): boolean {
  return ['RTW', 'ITW'].includes(typeToken(v));
}

export function isActionUnit(v: Vehicle): boolean {
  return idOf(v).startsWith(ACTION_PREFIX);
}

export function isHiddenUnit(v: Pick<Vehicle, 'game_vehicle_id'>): boolean {
  return HIDDEN_IDS.has(idOf(v));
}

export function alarmVehicleCount(v: Pick<Vehicle, 'game_vehicle_id' | 'modes'>, mode?: string): number {
  if (!isHiddenUnit(v)) return 1;
  const value = Number((mode || v.modes?.split(',')[0] || '').trim());
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function vehicleDisplayName(v: Vehicle): string {
  const id = idOf(v);
  const name = v.name?.trim();
  if (id === 'BSW' && (!name || ['BSW', 'BESTATTER'].includes(name.toUpperCase()))) {
    return 'Bestattungswagen';
  }
  return name || v.game_vehicle_id;
}

export function vehicleTypeLabel(v: Vehicle): string {
  const type = v.type?.trim() ?? '';
  if (['none', 'null', 'undefined', 'n/a'].includes(type.toLocaleLowerCase('de'))) return '';
  return /[A-ZÄÖÜ]/i.test(type) ? type : '';
}

export function mainTab(v: Vehicle): MainTab {
  if (RESCUE_TYPES.has(typeToken(v)) || RESCUE_STATIONS.has(station(v))) {
    return 'rescue';
  }
  return 'fire';
}

export const tabLabel: Record<MainTab, string> = {
  fire: 'Feuerwehr',
  rescue: 'Rettungsdienst',
};

export interface StationGroup {
  key: string;
  label: string;
  vehicles: Vehicle[];
}

function sortByName(list: Vehicle[]): Vehicle[] {
  const key = (v: Vehicle) => vehicleDisplayName(v) || String(v.id);
  return list.sort((a, b) => key(a).localeCompare(key(b), 'de', { numeric: true }));
}

export function vehicleAlarmPriority(v: Vehicle): number {
  const type = typeToken(v).replace(/[^A-Z0-9]/g, '');
  const id = idOf(v);
  const isGwrh = type === 'GWRH' || /(?:^|[_-])GW[-_]?RH(?:[_-]|$)/.test(id);

  if (type === 'KDOW' || type === 'KDO') return 0;
  if (type.startsWith('ELW')) return 1;
  if (type.startsWith('HLF')) return 2;
  if (type === 'DLK' || type === 'TMF') return 3;
  if ((type.startsWith('GW') && !isGwrh) || type === 'KLAF') return 4;
  if (type.startsWith('AB') || type === 'WLF') return 5;
  if (type.startsWith('NEF')) return 7;
  if (type.startsWith('RTW')) return 8;
  return 6;
}

export function sortVehiclesByAlarmPriority(list: Vehicle[]): Vehicle[] {
  const key = (v: Vehicle) => vehicleDisplayName(v) || String(v.id);
  return list.sort((a, b) => {
    const priority = vehicleAlarmPriority(a) - vehicleAlarmPriority(b);
    return priority || key(a).localeCompare(key(b), 'de', { numeric: true });
  });
}

function stationLabel(key: string): string {
  if (key === OTHER_KEY) return 'Weitere';
  if (key === '0') return 'Feuerwehrboote';
  if (key === 'CHRISTOPH') return 'Hubschrauber';
  if (key === '72' || key === '74') return `Rettungswache ${key}`;
  return `Wache ${key}`;
}

export function stationGroups(vehicles: Vehicle[], tab: MainTab): StationGroup[] {
  const order = tab === 'fire' ? FIRE_ORDER : RESCUE_ORDER;
  const buckets = new Map<string, Vehicle[]>();

  for (const v of vehicles) {
    if (isActionUnit(v) || isHiddenUnit(v) || mainTab(v) !== tab) continue;
    let key = station(v);
    if (!/^\d+$/.test(key) && key !== 'CHRISTOPH') {
      key = OTHER_KEY;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(v);
  }

  const rank = (key: string): number => {
    if (key === OTHER_KEY) return Number.MAX_SAFE_INTEGER;
    const idx = order.indexOf(key);
    return idx === -1 ? 1000 + Number(key) : idx;
  };

  return [...buckets.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({
      key,
      label: stationLabel(key),
      vehicles: sortVehiclesByAlarmPriority(buckets.get(key)!),
    }));
}

export function actionUnits(vehicles: Vehicle[]): Vehicle[] {
  return sortByName(vehicles.filter(isActionUnit));
}

// Die vier Hauptwachen stehen nebeneinander, Anbauwachen und Boote
// darunter im selben Strang
const FIRE_COLUMNS = [['1', '11'], ['2'], ['3', '31'], ['4', '0']];
const RESCUE_COLUMNS = [['1', 'CHRISTOPH'], ['2', '72'], ['3'], ['4', '74']];

export function stationColumns(vehicles: Vehicle[], tab: MainTab): StationGroup[][] {
  const groups = stationGroups(vehicles, tab);
  const layout = tab === 'fire' ? FIRE_COLUMNS : RESCUE_COLUMNS;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const used = new Set<string>();

  const columns = layout.map((keys) => {
    const column: StationGroup[] = [];
    for (const key of keys) {
      const group = byKey.get(key);
      if (group) {
        column.push(group);
        used.add(key);
      }
    }
    return column;
  });

  const rest = groups.filter((g) => !used.has(g.key));
  if (rest.length) {
    columns[columns.length - 1].push(...rest);
  }
  return columns;
}

// Gruppierung fürs Alarmierungsfenster: Feuerwehr und Rettungsdienst
// gemeinsam. Hauptwachen zuerst, dann die externen Wachen gebündelt,
// Hubschrauber separat, versteckte Einheiten (Stadtwerke, Polizei, …)
// ganz am Ende. Aktions-Einheiten laufen über die Aktionen-Leiste.
const ALARM_LAYOUT: { key: string; label: string; stations: string[] }[] = [
  { key: '1', label: 'Wache 1', stations: ['1'] },
  { key: '2', label: 'Wache 2', stations: ['2'] },
  { key: '3', label: 'Wache 3', stations: ['3'] },
  { key: '4', label: 'Wache 4', stations: ['4'] },
  { key: 'boote', label: 'Feuerwehrboote', stations: ['0'] },
  { key: 'fw-extern', label: 'Feuerwehr extern', stations: ['11', '31'] },
  { key: 'rd-extern', label: 'Rettungsdienst extern', stations: ['72', '74'] },
  { key: 'heli', label: 'Hubschrauber', stations: ['CHRISTOPH'] },
];

export function alarmGroups(vehicles: Vehicle[]): StationGroup[] {
  const buckets = new Map<string, Vehicle[]>();
  const rest: Vehicle[] = [];
  const hidden: Vehicle[] = [];

  for (const v of vehicles) {
    if (isActionUnit(v)) continue;
    if (isHiddenUnit(v)) {
      hidden.push(v);
      continue;
    }
    const s = station(v);
    const entry = ALARM_LAYOUT.find((e) => e.stations.includes(s));
    if (!entry) {
      rest.push(v);
      continue;
    }
    if (!buckets.has(entry.key)) buckets.set(entry.key, []);
    buckets.get(entry.key)!.push(v);
  }

  const groups: StationGroup[] = [];
  for (const entry of ALARM_LAYOUT) {
    const list = buckets.get(entry.key);
    if (list?.length) {
      groups.push({ key: entry.key, label: entry.label, vehicles: sortByName(list) });
    }
  }
  if (rest.length) {
    groups.push({ key: OTHER_KEY, label: 'Weitere', vehicles: sortByName(rest) });
  }
  if (hidden.length) {
    groups.push({ key: 'hidden', label: 'Weitere Einheiten', vehicles: sortByName(hidden) });
  }
  return groups;
}

// Löschzug pro Wache: Liste von Slots, jeder Slot nennt Alternativen.
// Über groups.json konfigurierbar (game_vehicle_ids), sonst greift die
// Typ-Heuristik: erstes verfügbares HLF/LF, dazu DLK, ELW und TLF.
let ZUEGE: Record<string, string[][]> = {};

const DEFAULT_ZUG_TYPES: string[][] = [['HLF', 'LF'], ['DLK', 'DL'], ['ELW'], ['TLF']];

export function loeschzugFor(group: StationGroup, isSelectable: (v: Vehicle) => boolean): Vehicle[] {
  if (group.key === 'fw-extern') return [];
  const picks: Vehicle[] = [];
  const taken = new Set<number>();

  const configured = ZUEGE[group.key];
  if (configured) {
    for (const alternatives of configured) {
      const pick = alternatives
        .map((id) => group.vehicles.find((v) => idOf(v) === id.toUpperCase()))
        .find((v) => v && isSelectable(v) && !taken.has(v.id));
      if (pick) {
        picks.push(pick);
        taken.add(pick.id);
      }
    }
    return picks;
  }

  for (const types of DEFAULT_ZUG_TYPES) {
    const pick = group.vehicles.find(
      (v) => types.includes(typeToken(v)) && isSelectable(v) && !taken.has(v.id)
    );
    if (pick) {
      picks.push(pick);
      taken.add(pick.id);
    }
  }
  return picks;
}

export function hasLoeschzug(group: StationGroup): boolean {
  if (group.key === 'fw-extern') return false;
  if (ZUEGE[group.key]?.length) return true;
  return group.vehicles.some((v) => DEFAULT_ZUG_TYPES.some((types) => types.includes(typeToken(v))));
}

// Einsatzart anhand des Stichworts
export type EventCategory = 'fire' | 'hazard' | 'water' | 'thl' | 'medical' | 'other';

const FIRE_WORDS = ['brand', 'feuer', 'rauch', 'brennt', 'explosion', 'qualm', 'müllverbrennung', 'muellverbrennung'];
const HAZARD_WORDS = ['stoffaustritt', 'gefahrgut', 'chemikal', 'chemieunfall', 'gasaustritt', 'giftstoff', 'radioaktiv', 'säure', 'saeure'];
const WATER_WORDS = ['wasser', 'gewässer', 'gewaesser', 'ertrink', 'boot', 'schiff', 'hafen', 'deich', 'hochwasser', 'überflut', 'ueberflut', 'eisrettung', 'taucher'];
const THL_WORDS = ['hilfeleistung', 'thl', 'vu ', 'vu-', 'unfall', 'öl', 'oel', 'baum', ' tür ', ' tuer ', 'türöffnung', 'tueroeffnung', 'sturm', 'keller', 'eingeklemmt', 'absturz'];
const THL_PHRASES = ['straße unter wasser', 'strasse unter wasser', 'person in aufzug', 'person im aufzug', 'person in fahrstuhl', 'person im fahrstuhl'];
const MED_WORDS = ['med', 'notfall', 'herz', 'kreislauf', 'sturz', 'gestürzt', 'gestuerzt', 'blutung', 'bewusstlos', 'atemnot', 'reanimation', 'verletzt', 'krank', 'vergiftung', 'psych', 'geburt', 'person'];

export function eventCategory(name: string | null | undefined): EventCategory {
  const hay = ` ${(name ?? '').toLowerCase()} `;
  if (FIRE_WORDS.some((w) => hay.includes(w))) return 'fire';
  if (HAZARD_WORDS.some((w) => hay.includes(w))) return 'hazard';
  if (THL_PHRASES.some((phrase) => hay.includes(phrase))) return 'thl';
  if (WATER_WORDS.some((w) => hay.includes(w))) return 'water';
  if (THL_WORDS.some((w) => hay.includes(w))) return 'thl';
  if (MED_WORDS.some((w) => hay.includes(w))) return 'medical';
  return 'other';
}

// Einheiten ohne echte Kartenposition melden Riesen-Koordinaten
export function hasMapPosition(v: Vehicle): boolean {
  return Math.abs(Number(v.x)) < 100000 && Math.abs(Number(v.y)) < 100000;
}

// Optionale groups.json neben der index.html erweitert die Erkennung ohne
// Rebuild:
// {
//   "rettungsdienst": ["MZF"],
//   "verstecken": ["KRAD"],
//   "loeschzuege": { "1": [["1_HLF_1", "1_HLF_2"], ["1_DLK_1"], ["1_ELW_1"]] }
// }
// Bei loeschzuege ist jeder innere Eintrag ein Slot mit Alternativen:
// das erste verfügbare Fahrzeug des Slots wird gewählt.
export async function loadGroupOverrides(): Promise<void> {
  try {
    const res = await fetch('./groups.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    for (const t of data.rettungsdienst ?? data.rescue ?? []) RESCUE_TYPES.add(String(t).toUpperCase());
    for (const t of data.verstecken ?? data.hidden ?? []) HIDDEN_IDS.add(String(t).toUpperCase());
    const zuege = data.loeschzuege ?? data.zuege;
    if (zuege && typeof zuege === 'object') {
      ZUEGE = {};
      for (const [wache, slots] of Object.entries(zuege)) {
        if (!Array.isArray(slots)) continue;
        ZUEGE[wache] = slots.map((slot) => (Array.isArray(slot) ? slot.map(String) : [String(slot)]));
      }
    }
  } catch {
    // keine groups.json vorhanden
  }
}
