import type { Point } from './mapview';
import type { Vehicle } from './types';

export type RoadKind = 'road' | 'bridge';

export interface RoadNode extends Point {
  id: string;
}

export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  kind: RoadKind;
}

export interface RoutingConfig {
  coordinate_space?: 'world' | 'normalized';
  meters_per_world_unit: number;
  meters_per_world_unit_x?: number;
  meters_per_world_unit_y?: number;
  map_width_px?: number;
  map_height_px?: number;
  pixels_per_meter?: number;
  grid_size_m?: number;
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface RouteDistance {
  meters: number;
  mode: 'road' | 'direct';
  fallback: boolean;
}

export interface RoadSnap {
  edgeId: string;
  point: Point;
  connectorMeters: number;
}

export interface RoadRoutePreview extends RouteDistance {
  startSnap: RoadSnap;
  endSnap: RoadSnap;
  roadMeters: number | null;
  points: Point[];
}

export interface RoutingNetworkIssue {
  code: 'component' | 'crossing' | 'duplicate' | 'outside' | 'empty';
  severity: 'error' | 'warning';
  message: string;
  point?: Point;
}

export interface RoutingNetworkReport {
  issues: RoutingNetworkIssue[];
  components: number;
  deadEnds: number;
  isolatedNodes: number;
  crossings: number;
}

export const DEFAULT_METERS_PER_WORLD_UNIT = 0.1;
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  coordinate_space: 'world',
  meters_per_world_unit: DEFAULT_METERS_PER_WORLD_UNIT,
  grid_size_m: 50,
  nodes: [],
  edges: [],
};

export const MAX_SNAP_DISTANCE_METERS = 300;
const DIRECT_TYPE_MARKERS = ['RTH', 'ITH', 'CHRISTOPH', 'FLB', 'BOOT', 'BOAT'];

interface EdgeProjection {
  edge: RoadEdge;
  from: RoadNode;
  to: RoadNode;
  t: number;
  connectorMeters: number;
  edgeMeters: number;
}

interface CompiledGraph {
  nodes: Map<string, RoadNode>;
  edges: Array<{ edge: RoadEdge; from: RoadNode; to: RoadNode; length: number }>;
  adjacency: Map<string, Array<{ id: string; length: number }>>;
}

const graphCache = new WeakMap<RoutingConfig, CompiledGraph>();

function finitePoint(point: Point): boolean {
  return Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function metricScale(config: RoutingConfig): { x: number; y: number } {
  const legacy = positiveNumber(config.meters_per_world_unit, DEFAULT_METERS_PER_WORLD_UNIT);
  if (config.coordinate_space === 'normalized') {
    const pixelsPerMeter = positiveNumber(config.pixels_per_meter, 0);
    const widthPixels = positiveNumber(config.map_width_px, 0);
    const heightPixels = positiveNumber(config.map_height_px, 0);
    if (pixelsPerMeter > 0 && widthPixels > 0 && heightPixels > 0) {
      return { x: widthPixels / pixelsPerMeter, y: heightPixels / pixelsPerMeter };
    }
  }
  return {
    x: positiveNumber(config.meters_per_world_unit_x, legacy),
    y: positiveNumber(config.meters_per_world_unit_y, legacy),
  };
}

function metricDistance(a: Point, b: Point, config: RoutingConfig): number {
  const scale = metricScale(config);
  return Math.hypot((Number(a.x) - Number(b.x)) * scale.x, (Number(a.y) - Number(b.y)) * scale.y);
}

export function cloneRoutingConfig(config: RoutingConfig): RoutingConfig {
  return {
    coordinate_space: config.coordinate_space,
    meters_per_world_unit: config.meters_per_world_unit,
    meters_per_world_unit_x: config.meters_per_world_unit_x,
    meters_per_world_unit_y: config.meters_per_world_unit_y,
    map_width_px: config.map_width_px,
    map_height_px: config.map_height_px,
    pixels_per_meter: config.pixels_per_meter,
    grid_size_m: config.grid_size_m,
    nodes: config.nodes.map((node) => ({ ...node })),
    edges: config.edges.map((edge) => ({ ...edge })),
  };
}

function importedPositiveNumber(value: unknown, fallback: number | undefined, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} muss eine positive Zahl sein.`);
  return number;
}

export function parseRoutingConfig(value: unknown, fallback: RoutingConfig = DEFAULT_ROUTING_CONFIG): RoutingConfig {
  const wrapper = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const source = wrapper?.routing && typeof wrapper.routing === 'object'
    ? wrapper.routing as Record<string, unknown>
    : wrapper;
  if (!source || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
    throw new Error('Die Datei enthält kein gültiges Straßennetz mit nodes und edges.');
  }
  if (source.nodes.length > 10_000 || source.edges.length > 20_000) {
    throw new Error('Das Straßennetz ist zu groß.');
  }

  const nodes: RoadNode[] = [];
  const nodeIds = new Set<string>();
  for (const entry of source.nodes) {
    if (!entry || typeof entry !== 'object') throw new Error('Mindestens ein Straßenpunkt ist ungültig.');
    const node = entry as Record<string, unknown>;
    const id = String(node.id ?? '');
    const x = Number(node.x);
    const y = Number(node.y);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || nodeIds.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Der Straßenpunkt ${id || 'ohne ID'} ist ungültig oder doppelt vorhanden.`);
    }
    nodeIds.add(id);
    nodes.push({ id, x, y });
  }

  const edges: RoadEdge[] = [];
  const edgeIds = new Set<string>();
  for (const entry of source.edges) {
    if (!entry || typeof entry !== 'object') throw new Error('Mindestens ein Straßenabschnitt ist ungültig.');
    const edge = entry as Record<string, unknown>;
    const id = String(edge.id ?? '');
    const from = String(edge.from ?? '');
    const to = String(edge.to ?? '');
    const kind = edge.kind === 'bridge' ? 'bridge' : edge.kind === undefined || edge.kind === 'road' ? 'road' : null;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || edgeIds.has(id) || !kind
      || from === to || !nodeIds.has(from) || !nodeIds.has(to)) {
      throw new Error(`Der Straßenabschnitt ${id || 'ohne ID'} ist ungültig oder doppelt vorhanden.`);
    }
    edgeIds.add(id);
    edges.push({ id, from, to, kind });
  }

  return {
    coordinate_space: source.coordinate_space === 'normalized' ? 'normalized' : 'world',
    meters_per_world_unit: importedPositiveNumber(source.meters_per_world_unit, fallback.meters_per_world_unit, 'Meter je Spielkoordinate')!,
    meters_per_world_unit_x: importedPositiveNumber(source.meters_per_world_unit_x, fallback.meters_per_world_unit_x, 'Horizontaler Maßstab'),
    meters_per_world_unit_y: importedPositiveNumber(source.meters_per_world_unit_y, fallback.meters_per_world_unit_y, 'Vertikaler Maßstab'),
    map_width_px: importedPositiveNumber(source.map_width_px, fallback.map_width_px, 'Texturbreite'),
    map_height_px: importedPositiveNumber(source.map_height_px, fallback.map_height_px, 'Texturhöhe'),
    pixels_per_meter: importedPositiveNumber(source.pixels_per_meter, fallback.pixels_per_meter, 'Pixel pro Meter'),
    grid_size_m: importedPositiveNumber(source.grid_size_m, fallback.grid_size_m ?? 50, 'Rasterweite'),
    nodes,
    edges,
  };
}

export function usesDirectLine(vehicle: Vehicle): boolean {
  const identity = `${vehicle.type ?? ''} ${vehicle.game_vehicle_id ?? ''}`.toUpperCase();
  return DIRECT_TYPE_MARKERS.some((marker) => new RegExp(`(^|[^A-Z0-9])${marker}([^A-Z0-9]|$)`).test(identity));
}

function validGraph(config: RoutingConfig): CompiledGraph {
  const cached = graphCache.get(config);
  if (cached) return cached;
  const nodes = new Map(
    config.nodes
      .filter((node) => node.id && finitePoint(node))
      .map((node) => [node.id, node]),
  );
  const edges = config.edges.flatMap((edge) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || from.id === to.id) return [];
    const length = metricDistance(from, to, config);
    return length > 0 ? [{ edge, from, to, length }] : [];
  });
  const adjacency = new Map<string, Array<{ id: string; length: number }>>();
  for (const { from, to, length } of edges) {
    adjacency.set(from.id, [...(adjacency.get(from.id) ?? []), { id: to.id, length }]);
    adjacency.set(to.id, [...(adjacency.get(to.id) ?? []), { id: from.id, length }]);
  }
  const graph = { nodes, edges, adjacency };
  graphCache.set(config, graph);
  return graph;
}

function nearestGraphProjection(point: Point, config: RoutingConfig): EdgeProjection | null {
  const graph = validGraph(config);
  const scale = metricScale(config);
  let nearest: EdgeProjection | null = null;
  for (const item of graph.edges) {
    const dx = item.to.x - item.from.x;
    const dy = item.to.y - item.from.y;
    const metricDx = dx * scale.x;
    const metricDy = dy * scale.y;
    const lengthSquared = metricDx * metricDx + metricDy * metricDy;
    const t = Math.max(0, Math.min(1, (
      (point.x - item.from.x) * scale.x * metricDx
      + (point.y - item.from.y) * scale.y * metricDy
    ) / lengthSquared));
    const projected = { x: item.from.x + dx * t, y: item.from.y + dy * t };
    const connectorMeters = metricDistance(point, projected, config);
    if (!nearest || connectorMeters < nearest.connectorMeters) {
      nearest = { edge: item.edge, from: item.from, to: item.to, t, connectorMeters, edgeMeters: item.length };
    }
  }
  return nearest;
}

function nearestProjection(point: Point, config: RoutingConfig): EdgeProjection | null {
  return nearestGraphProjection(point, config);
}

function projectionPoint(projection: EdgeProjection): Point {
  return {
    x: projection.from.x + (projection.to.x - projection.from.x) * projection.t,
    y: projection.from.y + (projection.to.y - projection.from.y) * projection.t,
  };
}

function publicSnap(projection: EdgeProjection): RoadSnap {
  return {
    edgeId: projection.edge.id,
    point: projectionPoint(projection),
    connectorMeters: projection.connectorMeters,
  };
}

export function nearestRoadSnap(point: Point, config: RoutingConfig): RoadSnap | null {
  if (!finitePoint(point)) return null;
  const projection = nearestProjection(point, config);
  return projection ? publicSnap(projection) : null;
}

function distancesFromProjection(config: RoutingConfig, origin: EdgeProjection): Map<string, number> {
  const graph = validGraph(config);
  const distances = new Map<string, number>([
    [origin.from.id, origin.edgeMeters * origin.t],
    [origin.to.id, origin.edgeMeters * (1 - origin.t)],
  ]);
  const visited = new Set<string>();
  const heap: Array<{ id: string; distance: number }> = [];

  function push(item: { id: string; distance: number }): void {
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent].distance <= item.distance) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = item;
  }

  function pop(): { id: string; distance: number } | null {
    if (!heap.length) return null;
    const first = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        const child = right < heap.length && heap[right].distance < heap[left].distance ? right : left;
        if (heap[child].distance >= last.distance) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    return first;
  }

  for (const [id, distance] of distances) push({ id, distance });

  while (heap.length) {
    const current = pop()!;
    const currentId = current.id;
    const currentDistance = current.distance;
    if (visited.has(currentId) || currentDistance !== distances.get(currentId)) continue;
    visited.add(currentId);
    for (const neighbor of graph.adjacency.get(currentId) ?? []) {
      const candidate = currentDistance + neighbor.length;
      if (candidate < (distances.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.id, candidate);
        push({ id: neighbor.id, distance: candidate });
      }
    }
  }

  return distances;
}

function distanceToProjection(start: EdgeProjection, end: EdgeProjection, fromEnd: Map<string, number>): number | null {
  const candidates = [
    (fromEnd.get(start.from.id) ?? Number.POSITIVE_INFINITY) + start.edgeMeters * start.t,
    (fromEnd.get(start.to.id) ?? Number.POSITIVE_INFINITY) + start.edgeMeters * (1 - start.t),
  ];
  if (start.edge.id === end.edge.id) candidates.push(start.edgeMeters * Math.abs(start.t - end.t));
  const shortest = Math.min(...candidates);
  return Number.isFinite(shortest) ? shortest : null;
}

function shortestRoadPath(config: RoutingConfig, start: EdgeProjection, end: EdgeProjection): { meters: number; points: Point[] } | null {
  const graph = validGraph(config);
  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; distance: number }> = [];

  function seed(id: string, distance: number): void {
    if (distance >= (distances.get(id) ?? Number.POSITIVE_INFINITY)) return;
    distances.set(id, distance);
    queue.push({ id, distance });
  }

  seed(start.from.id, start.edgeMeters * start.t);
  seed(start.to.id, start.edgeMeters * (1 - start.t));

  while (queue.length) {
    queue.sort((left, right) => right.distance - left.distance);
    const current = queue.pop()!;
    if (visited.has(current.id) || current.distance !== distances.get(current.id)) continue;
    visited.add(current.id);
    for (const neighbor of graph.adjacency.get(current.id) ?? []) {
      const candidate = current.distance + neighbor.length;
      if (candidate >= (distances.get(neighbor.id) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(neighbor.id, candidate);
      previous.set(neighbor.id, current.id);
      queue.push({ id: neighbor.id, distance: candidate });
    }
  }

  const targets = [
    { id: end.from.id, distance: (distances.get(end.from.id) ?? Number.POSITIVE_INFINITY) + end.edgeMeters * end.t },
    { id: end.to.id, distance: (distances.get(end.to.id) ?? Number.POSITIVE_INFINITY) + end.edgeMeters * (1 - end.t) },
  ];
  const best = targets.reduce((left, right) => left.distance <= right.distance ? left : right);
  const startPoint = projectionPoint(start);
  const endPoint = projectionPoint(end);
  if (start.edge.id === end.edge.id) {
    const direct = start.edgeMeters * Math.abs(start.t - end.t);
    if (direct <= best.distance) return { meters: direct, points: [startPoint, endPoint] };
  }
  if (!Number.isFinite(best.distance)) return null;

  const nodeIds = [best.id];
  while (previous.has(nodeIds.at(-1)!)) nodeIds.push(previous.get(nodeIds.at(-1)!)!);
  nodeIds.reverse();
  const points = [startPoint, ...nodeIds.flatMap((id) => {
    const node = graph.nodes.get(id);
    return node ? [{ x: node.x, y: node.y }] : [];
  }), endPoint].filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  return { meters: best.distance, points };
}

function interiorIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < 1e-10) return null;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const t = (acx * cdy - acy * cdx) / denominator;
  const u = (acx * aby - acy * abx) / denominator;
  const epsilon = 1e-6;
  if (t <= epsilon || t >= 1 - epsilon || u <= epsilon || u >= 1 - epsilon) return null;
  return { x: a.x + abx * t, y: a.y + aby * t };
}

export function validateRoutingNetwork(config: RoutingConfig): RoutingNetworkReport {
  const graph = validGraph(config);
  const issues: RoutingNetworkIssue[] = [];
  if (!graph.nodes.size || !graph.edges.length) {
    issues.push({ code: 'empty', severity: 'error', message: 'Das Straßennetz ist leer.' });
  }

  const seen = new Set<string>();
  const componentSizes: Array<{ size: number; first: RoadNode }> = [];
  for (const node of graph.nodes.values()) {
    if (seen.has(node.id)) continue;
    const queue = [node.id];
    seen.add(node.id);
    let size = 0;
    while (queue.length) {
      const current = queue.pop()!;
      size += 1;
      for (const neighbor of graph.adjacency.get(current) ?? []) {
        if (seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        queue.push(neighbor.id);
      }
    }
    componentSizes.push({ size, first: node });
  }
  componentSizes.sort((left, right) => right.size - left.size);
  if (componentSizes.length > 1) {
    const outsideMain = componentSizes.slice(1).reduce((sum, component) => sum + component.size, 0);
    issues.push({
      code: 'component',
      severity: 'error',
      message: `${componentSizes.length} getrennte Teilnetze; ${outsideMain} Punkte liegen außerhalb des Hauptnetzes.`,
      point: componentSizes[1].first,
    });
  }

  const logicalEdges = new Set<string>();
  for (const item of graph.edges) {
    const key = `${item.edge.kind}:${[item.from.id, item.to.id].sort().join(':')}`;
    if (logicalEdges.has(key)) {
      issues.push({ code: 'duplicate', severity: 'warning', message: `Abschnitt ${item.edge.id} ist doppelt vorhanden.`, point: item.from });
    }
    logicalEdges.add(key);
  }

  if (config.coordinate_space === 'normalized') {
    for (const node of graph.nodes.values()) {
      if (node.x < 0 || node.x > 1 || node.y < -1 || node.y > 0) {
        issues.push({ code: 'outside', severity: 'warning', message: `Punkt ${node.id} liegt außerhalb der Karte.`, point: node });
      }
    }
  }

  const roads = graph.edges.filter((item) => item.edge.kind === 'road');
  let crossings = 0;
  for (let left = 0; left < roads.length; left += 1) {
    for (let right = left + 1; right < roads.length; right += 1) {
      const a = roads[left];
      const b = roads[right];
      if (a.from.id === b.from.id || a.from.id === b.to.id || a.to.id === b.from.id || a.to.id === b.to.id) continue;
      const point = interiorIntersection(a.from, a.to, b.from, b.to);
      if (!point) continue;
      crossings += 1;
      if (crossings <= 20) {
        issues.push({ code: 'crossing', severity: 'warning', message: `Straßen ${a.edge.id} und ${b.edge.id} kreuzen sich ohne Knoten.`, point });
      }
    }
  }

  const degrees = [...graph.nodes.keys()].map((id) => graph.adjacency.get(id)?.length ?? 0);
  return {
    issues,
    components: componentSizes.length,
    deadEnds: degrees.filter((degree) => degree === 1).length,
    isolatedNodes: degrees.filter((degree) => degree === 0).length,
    crossings,
  };
}

export function roadRoutePreview(start: Point, end: Point, config: RoutingConfig): RoadRoutePreview | null {
  if (!finitePoint(start) || !finitePoint(end)) return null;
  const startProjection = nearestProjection(start, config);
  const endProjection = nearestProjection(end, config);
  if (!startProjection || !endProjection) return null;

  const startSnap = publicSnap(startProjection);
  const endSnap = publicSnap(endProjection);
  const path = shortestRoadPath(config, startProjection, endProjection);
  const directMeters = metricDistance(start, end, config);
  const usable = path
    && startSnap.connectorMeters <= MAX_SNAP_DISTANCE_METERS
    && endSnap.connectorMeters <= MAX_SNAP_DISTANCE_METERS;
  if (!usable) {
    return {
      meters: directMeters,
      mode: 'direct',
      fallback: true,
      startSnap,
      endSnap,
      roadMeters: path?.meters ?? null,
      points: path?.points ?? [],
    };
  }
  return {
    meters: startSnap.connectorMeters + path.meters + endSnap.connectorMeters,
    mode: 'road',
    fallback: false,
    startSnap,
    endSnap,
    roadMeters: path.meters,
    points: path.points,
  };
}

export function createRouteCalculator(end: Point, config: RoutingConfig): (start: Point, vehicle: Vehicle) => RouteDistance | null {
  const endProjection = nearestProjection(end, config);
  const fromEnd = endProjection ? distancesFromProjection(config, endProjection) : null;

  return (start: Point, vehicle: Vehicle): RouteDistance | null => {
    if (!finitePoint(start) || !finitePoint(end)) return null;
    const directMeters = metricDistance(start, end, config);
    if (!Number.isFinite(directMeters)) return null;

    if (usesDirectLine(vehicle)) return { meters: directMeters, mode: 'direct', fallback: false };
    const startProjection = nearestProjection(start, config);
    if (!startProjection || !endProjection || !fromEnd) return { meters: directMeters, mode: 'direct', fallback: true };
    if (startProjection.connectorMeters > MAX_SNAP_DISTANCE_METERS
      || endProjection.connectorMeters > MAX_SNAP_DISTANCE_METERS) {
      return { meters: directMeters, mode: 'direct', fallback: true };
    }

    const graphWorld = distanceToProjection(startProjection, endProjection, fromEnd);
    if (graphWorld === null) return { meters: directMeters, mode: 'direct', fallback: true };
    const meters = startProjection.connectorMeters + graphWorld + endProjection.connectorMeters;
    return { meters, mode: 'road', fallback: false };
  };
}

export function routeDistance(start: Point, end: Point, vehicle: Vehicle, config: RoutingConfig): RouteDistance | null {
  return createRouteCalculator(end, config)(start, vehicle);
}

export function formatDistance(distance: RouteDistance | null, includeMode = true): string {
  if (!distance) return '';
  const value = distance.meters < 1000
    ? `${Math.round(distance.meters)} m`
    : `${(distance.meters / 1000).toFixed(1).replace('.', ',')} km`;
  if (!includeMode) return value;
  if (distance.mode === 'road') return `${value} · Straße`;
  return `${value} · Luftlinie${distance.fallback ? ' (Fallback)' : ''}`;
}
