import { station, typeToken } from './classify';
import type { Vehicle } from './types';

// Zuordnung Fahrzeug → Grafik in public/vehicles/, abgestimmt auf die
// AUBMP-Flotte. Spezielle Einzelfahrzeuge zuerst, dann die Typ-Regel.
const SPECIFIC: Record<string, string> = {
  '1_HLF_2': 'HLF2',
  '3_ELW_1': 'ELW3',
  '3_WLF_1': 'WLF3',
  '4_GWRH_1': 'GWRH',
  '4_NEF_K': 'NEF2',
  '2_RTW_Z': 'RTW_Reserve',
  '4_RTW_R': 'RTW_Reserve',
  '2_ITW_R': 'ITW_Reserve',
  'CHRISTOPH_82': 'CHX82',
  'CHRISTOPH_84': 'CHX84',
  '0_FLB_1': 'FLB',
  '0_KLB_1': 'KLB',
};

const BY_TYPE = new Set([
  'KDOW', 'DLK', 'GWAS', 'KLAF', 'TMF', 'RW', 'KRAN', 'TLF',
  'GWW', 'GWSAN', 'KMB', 'GWL', 'ITW', 'ELW', 'WLF',
]);

const EXTERN_STATIONS = new Set(['72', '74']);

export function vehicleIconName(v: Vehicle): string | null {
  const id = (v.game_vehicle_id ?? '').toUpperCase();
  if (SPECIFIC[id]) return SPECIFIC[id];

  const type = typeToken(v);
  if (type === 'HLF') return 'HLF1';
  if (type === 'RTW') return EXTERN_STATIONS.has(station(v)) ? 'RTW_Ext' : 'RTW';
  if (type === 'NEF') return EXTERN_STATIONS.has(station(v)) ? 'NEF_Ext' : 'NEF';
  if (BY_TYPE.has(type)) return type;
  return null;
}
