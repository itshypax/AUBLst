import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vehicle } from './types';
import { loadVehicleIconManifest, vehicleIconPath } from './vehicleIcons';

const vehicle: Vehicle = {
  id: 1,
  game_vehicle_id: '1_HLF_1',
  name: '1-HLF-1',
  type: 'HLF',
  modes: null,
  x: 0,
  y: 0,
  status: 2,
  assigned_player_id: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('Fahrzeuggrafik-Manifeste', () => {
  it('wendet genaue Regeln vor Typregeln an', () => {
    const manifest = {
      modId: 'AUBMP',
      rules: [
        { game_vehicle_id: '1_HLF_1', file: 'HLF2.webp', src: './vehicles/AUBMP/HLF2.webp' },
        { type: 'HLF', file: 'HLF1.webp', src: './vehicles/AUBMP/HLF1.webp' },
      ],
    };
    expect(vehicleIconPath(vehicle, manifest)).toBe('./vehicles/AUBMP/HLF2.webp');
  });

  it('berücksichtigt Wachen in Typregeln', () => {
    const manifest = {
      modId: 'AUBMP',
      rules: [{ type: 'RTW', stations: ['72', '74'], file: 'RTW_Ext.webp', src: './vehicles/AUBMP/RTW_Ext.webp' }],
    };
    expect(vehicleIconPath({ ...vehicle, game_vehicle_id: '72_RTW_A' }, manifest)).toBe('./vehicles/AUBMP/RTW_Ext.webp');
    expect(vehicleIconPath({ ...vehicle, game_vehicle_id: '1_RTW_A' }, manifest)).toBeNull();
  });

  it('setzt Submod-Regeln vor die geerbten Regeln', async () => {
    const manifests: Record<string, object> = {
      './vehicles/AUBMP-Winter/manifest.json': {
        version: 3,
        extends: 'AUBMP',
        icons: [{ type: 'HLF', file: 'HLF-Winter.webp' }],
      },
      './vehicles/AUBMP/manifest.json': {
        version: 1,
        icons: [{ type: 'HLF', file: 'HLF1.webp' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = manifests[url];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response('', { status: 404 });
    }));

    const manifest = await loadVehicleIconManifest('AUBMP-Winter');

    expect(vehicleIconPath(vehicle, manifest)).toBe('./vehicles/AUBMP-Winter/HLF-Winter.webp?v=3');
  });

  it('liefert ohne Manifest keine modfremde Grafik', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await loadVehicleIconManifest('Unbekannt')).toBeNull();
  });

  it('ignoriert Pfade außerhalb des Mod-Ordners', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      icons: [{ type: 'HLF', file: '../AUBMP/HLF1.webp' }],
    }), { status: 200 })));

    const manifest = await loadVehicleIconManifest('Submod');

    expect(vehicleIconPath(vehicle, manifest)).toBeNull();
  });
});
