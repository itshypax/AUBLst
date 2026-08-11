import { describe, expect, it } from 'vitest';
import type { Vehicle } from './types';
import { formatDistance, nearestRoadSnap, parseRoutingConfig, roadRoutePreview, routeDistance, usesDirectLine, validateRoutingNetwork, type RoutingConfig } from './routing';

const landVehicle: Vehicle = {
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

const graph: RoutingConfig = {
  meters_per_world_unit: 0.1,
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 1000, y: 0 },
    { id: 'c', x: 1000, y: 1000 },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', kind: 'road' },
    { id: 'bc', from: 'b', to: 'c', kind: 'bridge' },
  ],
};

describe('Routing', () => {
  it('folgt für Landfahrzeuge dem Straßengraphen', () => {
    const result = routeDistance({ x: 0, y: 0 }, { x: 1000, y: 1000 }, landVehicle, graph);
    expect(result).toEqual({ meters: 200, mode: 'road', fallback: false });
    expect(formatDistance(result)).toBe('200 m · Straße');
  });

  it('liefert für den Editor Anschlusslinien und den vollständigen Straßenweg', () => {
    const preview = roadRoutePreview({ x: -100, y: 0 }, { x: 1000, y: 1100 }, graph);

    expect(preview?.mode).toBe('road');
    expect(preview?.startSnap.point).toEqual({ x: 0, y: 0 });
    expect(preview?.endSnap.point).toEqual({ x: 1000, y: 1000 });
    expect(preview?.startSnap.connectorMeters).toBe(10);
    expect(preview?.endSnap.connectorMeters).toBe(10);
    expect(preview?.roadMeters).toBe(200);
    expect(preview?.meters).toBe(220);
    expect(preview?.points).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ]);
  });

  it('nutzt bei getrennten Straßenteilen die Luftlinie als Fallback', () => {
    const disconnected: RoutingConfig = {
      ...graph,
      nodes: [...graph.nodes, { id: 'd', x: 2000, y: 0 }, { id: 'e', x: 3000, y: 0 }],
      edges: [...graph.edges, { id: 'de', from: 'd', to: 'e', kind: 'road' }],
    };
    const result = routeDistance({ x: 0, y: 0 }, { x: 3000, y: 0 }, landVehicle, disconnected);
    expect(result).toEqual({ meters: 300, mode: 'direct', fallback: true });
  });

  it('erkennt Hubschrauber und Boote unabhängig vom Straßennetz', () => {
    for (const game_vehicle_id of ['Christoph_82', '0_FLB_1']) {
      const vehicle = { ...landVehicle, game_vehicle_id, name: game_vehicle_id };
      expect(usesDirectLine(vehicle)).toBe(true);
      expect(routeDistance({ x: 0, y: 0 }, { x: 1000, y: 1000 }, vehicle, graph)?.mode).toBe('direct');
      expect(routeDistance({ x: 0, y: 0 }, { x: 1000, y: 1000 }, vehicle, graph)?.fallback).toBe(false);
    }
  });

  it('nutzt ohne Straßendaten weiterhin den konfigurierten Maßstab', () => {
    const result = routeDistance(
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      landVehicle,
      { meters_per_world_unit: 0.2, nodes: [], edges: [] },
    );
    expect(result).toEqual({ meters: 1000, mode: 'direct', fallback: true });
    expect(formatDistance(result)).toBe('1,0 km · Luftlinie (Fallback)');
  });

  it('berechnet AUBMP-Strecken aus Texturgröße und Pixelmaßstab', () => {
    const mapMeters = 8192 / 10.5;
    const calibrated: RoutingConfig = {
      meters_per_world_unit: 0.1,
      meters_per_world_unit_x: mapMeters / 1000,
      meters_per_world_unit_y: mapMeters / 1000,
      map_width_px: 8192,
      map_height_px: 8192,
      pixels_per_meter: 10.5,
      nodes: [
        { id: 'west', x: 0, y: 0 },
        { id: 'ost', x: 1000, y: 0 },
      ],
      edges: [{ id: 'quer', from: 'west', to: 'ost', kind: 'road' }],
    };
    const result = routeDistance({ x: 0, y: 0 }, { x: 1000, y: 0 }, landVehicle, calibrated);
    expect(result?.mode).toBe('road');
    expect(result?.meters).toBeCloseTo(mapMeters, 6);
  });

  it('nutzt im lokalen Editor den Pixelmaßstab für normalisierte Punkte', () => {
    const normalized: RoutingConfig = {
      coordinate_space: 'normalized',
      meters_per_world_unit: 0.1,
      map_width_px: 8192,
      map_height_px: 8192,
      pixels_per_meter: 10.5,
      nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }],
      edges: [{ id: 'ab', from: 'a', to: 'b', kind: 'road' }],
    };

    const snap = nearestRoadSnap({ x: 0.5, y: -0.1 }, normalized);
    expect(snap?.point).toEqual({ x: 0.5, y: 0 });
    expect(snap?.connectorMeters).toBeCloseTo((8192 / 10.5) * 0.1, 6);
  });

  it('ordnet Fahrzeuge unterschiedlichen eingezeichneten Hallenausfahrten zu', () => {
    const stationRoads: RoutingConfig = {
      meters_per_world_unit: 0.1,
      nodes: [
        { id: 'west', x: 0, y: 0 },
        { id: 'ost', x: 1000, y: 0 },
        { id: 'halle_west', x: 100, y: 100 },
        { id: 'halle_ost', x: 900, y: 100 },
      ],
      edges: [
        { id: 'hauptstrasse', from: 'west', to: 'ost', kind: 'road' },
        { id: 'ausfahrt_west', from: 'halle_west', to: 'west', kind: 'road' },
        { id: 'ausfahrt_ost', from: 'halle_ost', to: 'ost', kind: 'road' },
      ],
    };

    expect(nearestRoadSnap({ x: 100, y: 100 }, stationRoads)?.edgeId).toBe('ausfahrt_west');
    expect(nearestRoadSnap({ x: 900, y: 100 }, stationRoads)?.edgeId).toBe('ausfahrt_ost');
  });

  it('liest gespeicherte Routing-JSONs und prüft ihre Verweise', () => {
    const imported = parseRoutingConfig({ routing: {
      ...graph,
      coordinate_space: 'normalized',
    } });
    expect(imported.coordinate_space).toBe('normalized');
    expect(imported.nodes).toHaveLength(3);
    expect(imported.edges[1].kind).toBe('bridge');

    expect(() => parseRoutingConfig({
      ...graph,
      edges: [{ id: 'kaputt', from: 'a', to: 'unbekannt', kind: 'road' }],
    })).toThrow(/Straßenabschnitt/);
  });

  it('meldet getrennte Netze und Straßenkreuzungen ohne Knoten', () => {
    const invalid: RoutingConfig = {
      meters_per_world_unit: 1,
      nodes: [
        { id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 10 },
        { id: 'c', x: 0, y: 10 }, { id: 'd', x: 10, y: 0 },
      ],
      edges: [
        { id: 'ab', from: 'a', to: 'b', kind: 'road' },
        { id: 'cd', from: 'c', to: 'd', kind: 'road' },
      ],
    };

    const report = validateRoutingNetwork(invalid);
    expect(report.components).toBe(2);
    expect(report.crossings).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['component', 'crossing']));
  });
});
