// Befüllt ein laufendes AUBLst-Backend mit Demodaten (AUBMP-Namensschema)
// und gibt die Leitstellen-URL aus.
// Aufruf: node scripts/demo-seed.mjs [api-url]   (Standard: http://localhost:8791/api.php)

import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:8791/api.php';
const PIN = '1234';

async function post(action, body) {
  const res = await fetch(`${BASE}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${action}: ${data.error ?? res.status}`);
  return data;
}

// Kartenbild als Datei bereitstellen, kein Upload nötig
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(join(root, 'frontend', 'public', 'assets', 'map.jpg'), join(root, 'backend', 'maps', 'demo-city.jpg'));

const session = await post('session_create', {
  mod_id: 'demo-city',
  pin: PIN,
  map_bounds: { min_x: 0, min_y: 0, max_x: 1000, max_y: 700 },
});
const token = session.session_token;

await post('sync', {
  session_token: token,
  players: ['Josua', 'Gast'],
  vehicles: [
    { game_vehicle_id: '1_HLF_1', name: '1-HLF-1', type: '200', modes: 'Sondersignal,Still', x: 120, y: -340, status: 2 },
    { game_vehicle_id: '1_DLK_1', name: '1-DLK-1', type: '7', modes: 'Sondersignal,Still', x: 120, y: -345, status: 2 },
    { game_vehicle_id: '1_ELW_1', name: '1-ELW-1', type: '7', x: 400, y: -200, status: 3 },
    { game_vehicle_id: '11_HLF_1', name: '11-HLF-1', type: '200', modes: 'Sondersignal,Still', x: 180, y: -100, status: 2 },
    { game_vehicle_id: '2_HLF_1', name: '2-HLF-1', type: '200', modes: 'Sondersignal,Still', x: 430, y: -210, status: 4 },
    { game_vehicle_id: '3_TLF_1', name: '3-TLF-1', type: '200', modes: 'Sondersignal,Still', x: 640, y: -380, status: 2 },
    { game_vehicle_id: '31_GWL_1', name: '31-GWL-1', type: '7', x: 660, y: -390, status: 2 },
    { game_vehicle_id: '4_WLF_1', name: '4-WLF-1', type: '7', x: 800, y: -520, status: 6 },
    { game_vehicle_id: '0_FLB_1', name: 'FLB Oberschwaben', x: 500, y: -600, status: 2 },
    { game_vehicle_id: '1_RTW_A', name: '1-RTW-A', type: '24', modes: 'Sondersignal,Still', x: 122, y: -338, status: 2 },
    { game_vehicle_id: '2_RTW_A', name: '2-RTW-A', type: '24', modes: 'Sondersignal,Still', x: 428, y: -212, status: 1 },
    { game_vehicle_id: '4_NEF_A', name: '4-NEF-A', type: '21', modes: 'Sondersignal,Still', x: 802, y: -522, status: 2 },
    { game_vehicle_id: '4_GWSAN_1', name: '4-GW-SAN-1', type: '7', x: 803, y: -523, status: 2 },
    { game_vehicle_id: '72_RTW_A', name: '72-RTW-A', type: '24', modes: 'Sondersignal,Still', x: 260, y: -450, status: 2 },
    { game_vehicle_id: '74_RTW_B', name: '74-RTW-B', type: '24', modes: 'Sondersignal,Still', x: 700, y: -300, status: 3 },
    { game_vehicle_id: 'Christoph_82', name: 'Christoph 82', x: 130, y: -350, status: 2 },
    { game_vehicle_id: 'FS_LST_1', name: 'AuenPort', modes: 'Schiffsverkehr sperren,Schiffsverkehr freigeben', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'FS_LST_2', name: 'SWA Bahn', modes: 'Tramverkehr einstellen,Bahnstrecke sperren', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'FS_LST_3', name: 'Autobahn', modes: 'Richtung Osten sperren,Richtung Osten freigeben,Richtung Westen sperren,Richtung Westen freigeben', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'ASF', name: 'Abschleppwagen', modes: '1,2,3,4,Masterlift,Tieflader', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'BSW', name: 'Bestattungswagen', modes: '1,2,3,4', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'FuSTW', name: 'Streifenwagen', modes: '1,2,3', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'JA', name: 'Jaeger', x: -1000000, y: -1000000, status: 2 },
    { game_vehicle_id: 'TD', name: 'Stadtwerke', x: -1000000, y: -1000000, status: 2 },
  ],
  hospitals: [
    { game_hospital_id: 'kh_1', name: 'Uni-Klinikum', x: 300, y: -300, icu_total: 6, icu_available: 0, ward_total: 20, ward_available: 7 },
    { game_hospital_id: 'kh_2', name: 'Hanse-Klinikum', x: 700, y: -600, icu_total: 4, icu_available: 1, ward_total: 12, ward_available: 2 },
  ],
  events: [
    { game_event_id: 'ev_1', name: 'Wohnungsbrand Hauptstr. 12', x: 420, y: -215, status: 'active' },
  ],
  messages: [
    { entity_id: '2_HLF_1', message: 'S4', long_message: 'Florian Auenburg 2-HLF-1: Ankunft an Einsatzstelle', state: 'active' },
    { entity_id: '74_RTW_B', message: 'Sprechwunsch', long_message: 'Rotkreuz Auenburg 74-RTW-B mit Sprechwunsch', state: 'active' },
    { entity_id: '', message: '&#x1F68A', long_message: 'Tramverkehr eingestellt', state: 'active', type: 'global' },
  ],
  time: { h: 14, m: 35 },
});

console.log(`Session angelegt: Token ${token}, PIN ${PIN}`);
console.log('Leitstelle im Dev-Server:');
console.log(`  http://localhost:5173/?api_base=${encodeURIComponent(BASE)}&session_token=${token}&pin=${PIN}`);
