<script lang="ts">
  import { Check, Construction, Crosshair, Eraser, Grid3X3, Map as MapIcon, MapPin, Minus, Move, Plus, Route, Save, ShieldCheck, SlidersHorizontal, Trash2, Undo2, Unlink, Upload, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { api } from '../lib/api';
  import { eventCategory, station, type EventCategory } from '../lib/classify';
  import { canvasToWorld, imageDrawRect, toScreen, worldToCanvas, type MapView, type Point } from '../lib/mapview';
  import { cloneRoutingConfig, formatDistance, nearestRoadSnap, parseRoutingConfig, roadRoutePreview, validateRoutingNetwork, type RoadEdge, type RoadKind, type RoadNode, type RoadRoutePreview, type RoadSnap, type RoutingConfig, type RoutingNetworkReport } from '../lib/routing';
  import { app, askConfirm, assignedEventForVehicle, canWrite, openAssign, openVehicleMenu, setHighlightedEvent, setHighlightedVehicle, showNotice } from '../lib/state.svelte';
  import { statusDisplay } from '../lib/status';
  import { vehicleIconName } from '../lib/vehicleIcons';
  import type { EventItem, Vehicle } from '../lib/types';
  import StatusBadge from './StatusBadge.svelte';

  let { standaloneModId = null }: { standaloneModId?: string | null } = $props();

  let wrapper: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let importInput = $state<HTMLInputElement>();

  let img: HTMLImageElement | null = null;
  let natural = $state({ w: 0, h: 0 });
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let panning = $state(false);
  let dragged = false;
  let last = { x: 0, y: 0 };
  let hoverTarget = $state<'event' | 'vehicle' | null>(null);
  let hoverEventId = $state<number | null>(null);
  let hoverVehicleId = $state<number | null>(null);
  let hoverPos = $state({ x: 0, y: 0 });
  let placing = $state(false);
  let filtersOpen = $state(false);
  let showVehicles = $state(true);
  let showEvents = $state(true);
  let hiddenStatuses = $state<Set<number>>(new Set());
  let hiddenCategories = $state<Set<EventCategory>>(new Set());
  let hiddenStations = $state<Set<string>>(new Set());
  let canvasSize = $state({ w: 0, h: 0 });
  let editorOpen = $state(false);
  type EditorMode = RoadKind | 'erase' | 'unlink' | 'test';
  let editorMode = $state<EditorMode>('road');
  let editorGraph = $state<RoutingConfig>(cloneRoutingConfig(app.routing));
  let editorHistory = $state<RoutingConfig[]>([]);
  let editorActiveNodeId = $state<string | null>(null);
  let editorCursorWorld = $state<Point | null>(null);
  let editorHoverNodeId = $state<string | null>(null);
  let editorDragNodeId = $state<string | null>(null);
  let editorDragHistoryRecorded = false;
  let editorPointerStart = { x: 0, y: 0 };
  type EditorSnapTarget =
    | { kind: 'node'; nodeId: string; world: Point }
    | { kind: 'edge'; edgeId: string; t: number; world: Point }
    | null;
  let editorSnapTarget = $state<EditorSnapTarget>(null);
  let showEditorGrid = $state(true);
  let editorDirty = $state(false);
  let editorSaving = $state(false);
  let editorError = $state('');
  let routeTestStart = $state<Point | null>(null);
  let routeTestEnd = $state<Point | null>(null);
  let routeTestStartSnap = $state<RoadSnap | null>(null);
  let routeTestPreview = $state<RoadRoutePreview | null>(null);
  let networkReport = $state<RoutingNetworkReport | null>(null);
  let routeIdCounter = 0;
  const localHostname = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
  const editorAvailable = $derived(import.meta.env.DEV && localHostname && (Boolean(standaloneModId) || new URLSearchParams(location.search).get('routing_editor') === '1'));
  let standaloneEditorOpened = false;
  const stations = $derived([...new Set(app.vehicles.map(station))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })));
  const visibleEvents = $derived(showEvents ? app.events.filter((event) => !hiddenCategories.has(eventCategory(event.name))) : []);
  const visibleVehicles = $derived(showVehicles ? app.vehicles.filter((vehicle) => !hiddenStatuses.has(Number(vehicle.status)) && !hiddenStations.has(station(vehicle))) : []);
  const hoverEvent = $derived(visibleEvents.find((event) => event.id === hoverEventId) ?? null);
  const tooltipEvent = $derived(hoverEvent ?? visibleEvents.find((event) => event.id === app.highlightedEventId) ?? null);
  const hoverVehicle = $derived(visibleVehicles.find((v) => v.id === hoverVehicleId) ?? null);
  const tooltipVehicle = $derived(hoverVehicle ?? visibleVehicles.find((v) => v.id === app.highlightedVehicleId) ?? null);
  const eventTooltipPosition = $derived.by(() => {
    if (!tooltipEvent || !canvas || hoverEvent) return hoverPos;
    return toScreen(worldToCanvas(tooltipEvent, app.mapBounds, view()), view());
  });
  const vehicleTooltipPosition = $derived.by(() => {
    if (!tooltipVehicle || !canvas || hoverVehicle) return hoverPos;
    return toScreen(worldToCanvas(tooltipVehicle, app.mapBounds, view()), view());
  });
  const STATUS_LABELS = ['Alarmiert', 'Einsatzbereit Funk', 'Einsatzbereit Wache', 'Einsatz übernommen', 'An Einsatzstelle', 'Sprechwunsch', 'Nicht einsatzbereit', 'Patient aufgenommen', 'Am Transportziel'];
  const CATEGORY_LABELS: Record<EventCategory, string> = { fire: 'Brand', hazard: 'Gefahrgut', water: 'Wasser', thl: 'Hilfeleistung', medical: 'Rettungsdienst', other: 'Sonstige' };
  const CATEGORIES = Object.keys(CATEGORY_LABELS) as EventCategory[];
  type EventMarkerKind = EventCategory | 'control-room';

  const scaleBar = $derived.by(() => {
    const routing = editorOpen ? editorGraph : app.routing;
    const scale = Number(routing.meters_per_world_unit_x ?? routing.meters_per_world_unit);
    const worldWidth = app.mapBounds.max_x - app.mapBounds.min_x;
    if (!canvas || canvasSize.w <= 0 || !Number.isFinite(scale) || scale <= 0 || worldWidth <= 0) return null;
    const drawWidth = imageDrawRect(view()).w * zoom;
    const metersPerPixel = worldWidth * scale / drawWidth;
    const targetMeters = metersPerPixel * 90;
    const power = 10 ** Math.floor(Math.log10(Math.max(1, targetMeters)));
    const normalized = targetMeters / power;
    const nice = (normalized < 2 ? 1 : normalized < 5 ? 2 : 5) * power;
    return { meters: nice, pixels: Math.max(24, nice / metersPerPixel) };
  });
  const editorMapMetric = $derived.by(() => {
    const widthPx = Number(editorGraph.map_width_px);
    const heightPx = Number(editorGraph.map_height_px);
    const pixelsPerMeter = Number(editorGraph.pixels_per_meter);
    if (![widthPx, heightPx, pixelsPerMeter].every((value) => Number.isFinite(value) && value > 0)) return null;
    const widthMeters = widthPx / pixelsPerMeter;
    const heightMeters = heightPx / pixelsPerMeter;
    return { widthMeters, heightMeters, areaSquareKilometers: widthMeters * heightMeters / 1_000_000 };
  });

  const iconCache = new Map<string, HTMLImageElement>();
  function iconFor(v: Vehicle): HTMLImageElement | null {
    const name = vehicleIconName(v);
    if (!name) return null;
    let image = iconCache.get(name);
    if (!image) {
      image = new Image();
      image.onload = () => scheduleRender();
    image.src = `./vehicles/${name}.webp`;
      iconCache.set(name, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 4;
  const EDITOR_SNAP_PIXELS = 17;
  const EDITOR_DRAG_PIXELS = 4;
  const VEHICLE_ICON_SIZE = 54;
  const VEHICLE_ICON_HIGHLIGHT_SIZE = 66;
  const VEHICLE_HIT_RADIUS = 30;
  const VEHICLE_HIGHLIGHT_HIT_RADIUS = 38;

  const cssVars = new Map<string, string>();
  function cssVar(name: string, fallback: string): string {
    if (!cssVars.has(name)) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      cssVars.set(name, value || fallback);
    }
    return cssVars.get(name)!;
  }

  function statusColor(status: number | string): string {
    return cssVar(`--status-${status}-start`, cssVar('--good', '#2ec98e'));
  }

  function eventColor(category: EventMarkerKind): string {
    if (category === 'fire') return cssVar('--danger', '#e85b62');
    if (category === 'hazard') return cssVar('--warn', '#f0a03c');
    if (category === 'water') return cssVar('--water', '#2aa6b7');
    if (category === 'thl') return cssVar('--accent', '#4c8dff');
    if (category === 'medical') return cssVar('--good', '#2ec98e');
    if (category === 'control-room') return cssVar('--accent', '#4c8dff');
    return cssVar('--text-dim', '#9aa3b2');
  }

  const eventIconNodes: Record<EventMarkerKind, string> = {
    fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    hazard: '<circle cx="12" cy="11.9" r="2"/><path d="M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6"/><path d="m8.9 10.1 1.4.8"/><path d="M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5"/><path d="m15.1 10.1-1.4.8"/><path d="M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2"/><path d="M12 13.9v1.6"/><path d="M13.5 5.4c-1-.2-2-.2-3 0"/><path d="M17 16.4c.7-.7 1.2-1.6 1.5-2.5"/><path d="M5.5 13.9c.3.9.8 1.8 1.5 2.5"/>',
    water: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    thl: '<path d="m14 12-8.5 8.5a2.12 2.12 0 1 1-3-3L11 9"/><path d="M15 13 9 7l4-4 6 6h3a8 8 0 0 1-7 7z"/>',
    medical: '<path d="M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a1 1 0 0 1 1 1v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a1 1 0 0 1 1-1h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4a1 1 0 0 1-1-1V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4a1 1 0 0 1-1 1z"/>',
    other: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'control-room': '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>',
  };
  const eventIconCache = new Map<EventMarkerKind, HTMLImageElement>();

  function eventIconFor(kind: EventMarkerKind): HTMLImageElement | null {
    let image = eventIconCache.get(kind);
    if (!image) {
      image = new Image();
      image.onload = () => scheduleRender();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${eventIconNodes[kind]}</svg>`;
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      eventIconCache.set(kind, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  function view(): MapView {
    return { zoom, pan, natural, width: canvas.clientWidth, height: canvas.clientHeight };
  }

  let renderQueued = false;
  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  let resizeQueued = false;
  function scheduleResize(): void {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  }

  function resize(): void {
    if (!canvas || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    canvasSize = { w: rect.width, h: rect.height };
    render();
  }

  $effect(() => {
    const observer = new ResizeObserver(() => scheduleResize());
    observer.observe(wrapper);
    resize();
    return () => observer.disconnect();
  });

  $effect(() => {
    const url = app.mapImageUrl;
    img = null;
    natural = { w: 0, h: 0 };
    resetView();
    if (url) {
      const image = new Image();
      image.onload = () => {
        img = image;
        natural = { w: image.naturalWidth, h: image.naturalHeight };
        if (standaloneModId && (!editorGraph.map_width_px || !editorGraph.map_height_px)) {
          editorGraph = {
            ...editorGraph,
            map_width_px: editorGraph.map_width_px || image.naturalWidth,
            map_height_px: editorGraph.map_height_px || image.naturalHeight,
          };
        }
        scheduleRender();
      };
      image.onerror = () => console.warn('Kartenbild konnte nicht geladen werden');
      image.src = url;
    }
    scheduleRender();
  });

  $effect(() => {
    if (standaloneModId && app.mapImageUrl && !standaloneEditorOpened) {
      standaloneEditorOpened = true;
      openEditor();
    }
  });

  $effect(() => {
    void app.vehicles;
    void app.events;
    void app.mapBounds;
    void app.highlightedEventId;
    void app.highlightedVehicleId;
    void visibleEvents;
    void visibleVehicles;
    scheduleRender();
  });

  // Fokus einmalig anwenden und verbrauchen; untrack verhindert, dass der
  // Effekt am 3-Sekunden-Polling (neues mapBounds-Objekt) hängen bleibt und
  // die Karte immer wieder zurückzentriert
  $effect(() => {
    const fp = app.focusPoint;
    if (!fp || !canvas) return;
    untrack(() => {
      zoom = Math.max(zoom, 1.6);
      const p = worldToCanvas({ x: fp.x, y: fp.y }, app.mapBounds, view());
      pan = {
        x: canvas.clientWidth / 2 - p.x * zoom,
        y: canvas.clientHeight / 2 - p.y * zoom,
      };
      scheduleRender();
    });
    app.focusPoint = null;
  });

  function clientToCanvas(clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function editorId(prefix: 'n' | 'e'): string {
    routeIdCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${routeIdCounter.toString(36)}`;
  }

  function recordEditorHistory(): void {
    editorHistory = [...editorHistory.slice(-49), cloneRoutingConfig(editorGraph)];
  }

  function openEditor(): void {
    editorGraph = cloneRoutingConfig(app.routing);
    editorHistory = [];
    editorActiveNodeId = null;
    editorCursorWorld = null;
    editorHoverNodeId = null;
    editorDragNodeId = null;
    editorSnapTarget = null;
    showEditorGrid = true;
    editorDirty = false;
    editorError = '';
    editorMode = 'road';
    resetRouteTest();
    networkReport = null;
    placing = false;
    filtersOpen = false;
    editorOpen = true;
    scheduleRender();
  }

  async function closeEditor(): Promise<void> {
    if (editorSaving) return;
    if (editorDirty && !await askConfirm('Ungespeicherte Änderungen am Straßennetz verwerfen?')) return;
    editorOpen = false;
    editorActiveNodeId = null;
    editorCursorWorld = null;
    editorError = '';
    scheduleRender();
  }

  function undoEditor(): void {
    const previous = editorHistory.at(-1);
    if (!previous) return;
    editorGraph = cloneRoutingConfig(previous);
    editorHistory = editorHistory.slice(0, -1);
    editorActiveNodeId = null;
    networkReport = null;
    editorDirty = true;
    scheduleRender();
  }

  function resetRouteTest(): void {
    routeTestStart = null;
    routeTestEnd = null;
    routeTestStartSnap = null;
    routeTestPreview = null;
  }

  function setEditorMode(mode: EditorMode): void {
    editorMode = mode;
    editorActiveNodeId = null;
    editorCursorWorld = null;
    editorSnapTarget = null;
    if (mode !== 'test') resetRouteTest();
    scheduleRender();
  }

  function finishEditorLine(): void {
    editorActiveNodeId = null;
    editorCursorWorld = null;
    editorSnapTarget = null;
    scheduleRender();
  }

  function nodeScreen(node: RoadNode): Point {
    const mapView = view();
    return toScreen(worldToCanvas(node, app.mapBounds, mapView), mapView);
  }

  function nearestEditorNode(pos: Point, maxPixels = EDITOR_SNAP_PIXELS, excludeNodeId: string | null = null): RoadNode | null {
    let result: RoadNode | null = null;
    let distance = maxPixels;
    for (const node of editorGraph.nodes) {
      if (node.id === excludeNodeId) continue;
      const screen = nodeScreen(node);
      const candidate = Math.hypot(screen.x - pos.x, screen.y - pos.y);
      if (candidate <= distance) {
        distance = candidate;
        result = node;
      }
    }
    return result;
  }

  function nearestEditorEdge(pos: Point, maxPixels = EDITOR_SNAP_PIXELS, excludeNodeId: string | null = null): { edge: RoadEdge; t: number; world: Point } | null {
    const nodes = new Map(editorGraph.nodes.map((node) => [node.id, node]));
    let result: { edge: RoadEdge; t: number; world: Point } | null = null;
    let distance = maxPixels;
    for (const edge of editorGraph.edges) {
      if (excludeNodeId && (edge.from === excludeNodeId || edge.to === excludeNodeId)) continue;
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) continue;
      const a = nodeScreen(from);
      const b = nodeScreen(to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0) continue;
      const t = Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / lengthSquared));
      const candidate = Math.hypot(pos.x - (a.x + dx * t), pos.y - (a.y + dy * t));
      if (candidate <= distance) {
        distance = candidate;
        result = {
          edge,
          t,
          world: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        };
      }
    }
    return result;
  }

  function editorSnapAt(pos: Point, excludeNodeId: string | null = null): EditorSnapTarget {
    const node = nearestEditorNode(pos, EDITOR_SNAP_PIXELS, excludeNodeId);
    if (node) return { kind: 'node', nodeId: node.id, world: { x: node.x, y: node.y } };
    const edge = nearestEditorEdge(pos, EDITOR_SNAP_PIXELS, excludeNodeId);
    if (edge) return { kind: 'edge', edgeId: edge.edge.id, t: edge.t, world: edge.world };
    return null;
  }

  function splitEditorEdge(match: { edge: RoadEdge; t: number; world: Point }): RoadNode {
    if (match.t < 0.02) return editorGraph.nodes.find((node) => node.id === match.edge.from)!;
    if (match.t > 0.98) return editorGraph.nodes.find((node) => node.id === match.edge.to)!;
    const node = { id: editorId('n'), ...match.world };
    editorGraph.nodes = [...editorGraph.nodes, node];
    editorGraph.edges = [
      ...editorGraph.edges.filter((edge) => edge.id !== match.edge.id),
      { id: editorId('e'), from: match.edge.from, to: node.id, kind: match.edge.kind },
      { id: editorId('e'), from: node.id, to: match.edge.to, kind: match.edge.kind },
    ];
    return node;
  }

  function edgeExists(from: string, to: string, kind: RoadKind): boolean {
    return editorGraph.edges.some((edge) => edge.kind === kind && (
      (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
    ));
  }

  function appendEdge(from: string, to: string, kind: RoadKind): void {
    if (from === to || edgeExists(from, to, kind)) return;
    editorGraph.edges = [...editorGraph.edges, { id: editorId('e'), from, to, kind }];
  }

  function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { t: number; u: number; world: Point } | null {
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
    return { t, u, world: { x: a.x + abx * t, y: a.y + aby * t } };
  }

  function addEditorEdge(fromId: string, toId: string, kind: RoadKind): void {
    const nodes = new Map(editorGraph.nodes.map((node) => [node.id, node]));
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to || fromId === toId) return;

    if (kind === 'bridge') {
      appendEdge(fromId, toId, kind);
      return;
    }

    const crossings = editorGraph.edges.flatMap((edge) => {
      if (edge.kind !== 'road' || edge.from === fromId || edge.to === fromId || edge.from === toId || edge.to === toId) return [];
      const edgeFrom = nodes.get(edge.from);
      const edgeTo = nodes.get(edge.to);
      if (!edgeFrom || !edgeTo) return [];
      const intersection = segmentIntersection(from, to, edgeFrom, edgeTo);
      return intersection ? [{ edge, ...intersection }] : [];
    }).sort((left, right) => left.t - right.t);

    const chain = [fromId];
    for (const crossing of crossings) {
      const crossingNode = splitEditorEdge({ edge: crossing.edge, t: crossing.u, world: crossing.world });
      if (chain.at(-1) !== crossingNode.id) chain.push(crossingNode.id);
    }
    chain.push(toId);
    for (let index = 1; index < chain.length; index += 1) appendEdge(chain[index - 1], chain[index], kind);
  }

  function editorNodeAt(pos: Point): RoadNode {
    const existing = nearestEditorNode(pos);
    if (existing) return existing;
    const edge = nearestEditorEdge(pos);
    if (edge) return splitEditorEdge(edge);
    const node = { id: editorId('n'), ...canvasToWorld(pos, app.mapBounds, view()) };
    editorGraph.nodes = [...editorGraph.nodes, node];
    return node;
  }

  function dedupeEditorEdges(): void {
    const seen = new Set<string>();
    editorGraph.edges = editorGraph.edges.filter((edge) => {
      if (edge.from === edge.to) return false;
      const endpoints = [edge.from, edge.to].sort().join(':');
      const key = `${edge.kind}:${endpoints}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeEditorNode(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    editorGraph.edges = editorGraph.edges.map((edge) => ({
      ...edge,
      from: edge.from === sourceId ? targetId : edge.from,
      to: edge.to === sourceId ? targetId : edge.to,
    }));
    editorGraph.nodes = editorGraph.nodes.filter((node) => node.id !== sourceId);
    dedupeEditorEdges();
    if (editorActiveNodeId === sourceId) editorActiveNodeId = targetId;
  }

  function attachEditorNodeToEdge(nodeId: string, target: Extract<NonNullable<EditorSnapTarget>, { kind: 'edge' }>): void {
    const edge = editorGraph.edges.find((candidate) => candidate.id === target.edgeId);
    const node = editorGraph.nodes.find((candidate) => candidate.id === nodeId);
    if (!edge || !node || edge.from === nodeId || edge.to === nodeId) return;
    node.x = target.world.x;
    node.y = target.world.y;
    editorGraph.edges = editorGraph.edges.filter((candidate) => candidate.id !== edge.id);
    appendEdge(edge.from, nodeId, edge.kind);
    appendEdge(nodeId, edge.to, edge.kind);
  }

  function moveEditorNode(nodeId: string, pos: Point): void {
    const node = editorGraph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    editorSnapTarget = editorSnapAt(pos, nodeId);
    const world = editorSnapTarget?.world ?? canvasToWorld(pos, app.mapBounds, view());
    editorCursorWorld = world;
    node.x = world.x;
    node.y = world.y;
    editorGraph = { ...editorGraph, nodes: [...editorGraph.nodes] };
  }

  function finishEditorNodeDrag(nodeId: string): void {
    if (editorSnapTarget?.kind === 'node') mergeEditorNode(nodeId, editorSnapTarget.nodeId);
    else if (editorSnapTarget?.kind === 'edge') attachEditorNodeToEdge(nodeId, editorSnapTarget);
    dedupeEditorEdges();
    editorSnapTarget = null;
    editorDragNodeId = null;
    editorDragHistoryRecorded = false;
    editorDirty = true;
    networkReport = null;
    scheduleRender();
  }

  function removeEditorEdge(edgeId: string): void {
    editorGraph.edges = editorGraph.edges.filter((edge) => edge.id !== edgeId);
    const used = new Set(editorGraph.edges.flatMap((edge) => [edge.from, edge.to]));
    editorGraph.nodes = editorGraph.nodes.filter((node) => used.has(node.id));
  }

  function removeEditorNode(nodeId: string): void {
    editorGraph.edges = editorGraph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
    editorGraph.nodes = editorGraph.nodes.filter((node) => node.id !== nodeId);
    if (editorActiveNodeId === nodeId) editorActiveNodeId = null;
  }

  function editAt(pos: Point): void {
    if (editorMode === 'test') {
      const point = canvasToWorld(pos, app.mapBounds, view());
      if (!routeTestStart || routeTestEnd) {
        routeTestStart = point;
        routeTestEnd = null;
        routeTestStartSnap = nearestRoadSnap(point, editorGraph);
        routeTestPreview = null;
      } else {
        routeTestEnd = point;
        routeTestPreview = roadRoutePreview(routeTestStart, point, editorGraph);
      }
      scheduleRender();
      return;
    }

    if (editorMode === 'unlink') {
      const match = nearestEditorEdge(pos, 14);
      if (!match) return;
      recordEditorHistory();
      removeEditorEdge(match.edge.id);
      editorDirty = true;
      networkReport = null;
      scheduleRender();
      return;
    }

    if (editorMode === 'erase') {
      const node = nearestEditorNode(pos, 12);
      if (node) {
        recordEditorHistory();
        removeEditorNode(node.id);
        editorDirty = true;
        networkReport = null;
        scheduleRender();
        return;
      }
      return;
    }

    recordEditorHistory();
    const node = editorNodeAt(pos);
    if (editorActiveNodeId && editorActiveNodeId !== node.id) {
      addEditorEdge(editorActiveNodeId, node.id, editorMode);
    }
    editorActiveNodeId = node.id;
    editorDirty = true;
    networkReport = null;
    scheduleRender();
  }

  async function clearEditor(): Promise<void> {
    if (!editorGraph.edges.length && !editorGraph.nodes.length) return;
    if (!await askConfirm('Das gesamte Straßennetz dieser Karte löschen?')) return;
    recordEditorHistory();
    editorGraph.nodes = [];
    editorGraph.edges = [];
    editorActiveNodeId = null;
    resetRouteTest();
    networkReport = null;
    editorDirty = true;
    scheduleRender();
  }

  async function importEditorFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (editorDirty && !await askConfirm('Die ungespeicherten Änderungen durch die geladene JSON-Datei ersetzen?')) return;

    editorError = '';
    try {
      const imported = parseRoutingConfig(JSON.parse(await file.text()), editorGraph);
      if (standaloneModId && imported.coordinate_space !== 'normalized') {
        throw new Error('Der lokale Editor benötigt ein Straßennetz mit coordinate_space "normalized".');
      }
      recordEditorHistory();
      editorGraph = cloneRoutingConfig(imported);
      editorActiveNodeId = null;
      editorSnapTarget = null;
      resetRouteTest();
      networkReport = null;
      editorDirty = true;
      showNotice(`${file.name} geladen · ${imported.nodes.length} Punkte · ${imported.edges.length} Abschnitte`);
    } catch (error) {
      editorError = error instanceof SyntaxError
        ? 'Die gewählte Datei enthält kein gültiges JSON.'
        : (error as Error).message;
    }
    scheduleRender();
  }

  function updateEditorScale(value: string): void {
    const scale = Number(value.replace(',', '.'));
    if (!Number.isFinite(scale) || scale <= 0) return;
    editorGraph.meters_per_world_unit = scale;
    editorDirty = true;
    networkReport = null;
  }

  function updateEditorMetric(key: 'map_width_px' | 'map_height_px' | 'pixels_per_meter' | 'grid_size_m', value: string): void {
    const number = Number(value.replace(',', '.'));
    if (!Number.isFinite(number) || number <= 0) return;
    editorGraph = { ...editorGraph, [key]: number };
    editorDirty = true;
    networkReport = null;
    scheduleRender();
  }

  async function saveEditor(): Promise<void> {
    if (editorSaving || (!standaloneModId && !canWrite())) return;
    editorSaving = true;
    editorError = '';
    try {
      const payload = {
        coordinate_space: standaloneModId ? 'normalized' : editorGraph.coordinate_space,
        meters_per_world_unit: editorGraph.meters_per_world_unit,
        map_width_px: editorGraph.map_width_px,
        map_height_px: editorGraph.map_height_px,
        pixels_per_meter: editorGraph.pixels_per_meter,
        grid_size_m: editorGraph.grid_size_m,
        nodes: editorGraph.nodes,
        edges: editorGraph.edges,
      };
      let saved: RoutingConfig;
      if (standaloneModId) {
        const response = await fetch(`/__routing-editor?mod_id=${encodeURIComponent(standaloneModId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json() as RoutingConfig & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Speichern fehlgeschlagen');
        saved = result;
      } else {
        saved = await api<RoutingConfig>('routing_put', payload);
      }
      app.routing = cloneRoutingConfig(saved);
      editorGraph = cloneRoutingConfig(saved);
      editorHistory = [];
      editorDirty = false;
      showNotice(standaloneModId ? `${standaloneModId}.routing.json gespeichert` : 'Straßennetz gespeichert');
    } catch (error) {
      editorError = (error as Error).message;
    } finally {
      editorSaving = false;
      scheduleRender();
    }
  }

  function runNetworkCheck(): void {
    networkReport = validateRoutingNetwork(editorGraph);
    const errors = networkReport.issues.filter((issue) => issue.severity === 'error').length;
    const warnings = networkReport.issues.length - errors;
    if (!errors && !warnings) showNotice('Netzprüfung ohne Fehler abgeschlossen');
    else showNotice(`Netzprüfung: ${errors} Fehler · ${warnings} Hinweise`, errors ? 'error' : 'success');
    scheduleRender();
  }

  function focusNetworkIssue(point: Point | undefined): void {
    if (!point || !canvas) return;
    zoom = Math.max(zoom, 1.8);
    const canvasPoint = worldToCanvas(point, app.mapBounds, view());
    pan = {
      x: canvas.clientWidth / 2 - canvasPoint.x * zoom,
      y: canvas.clientHeight / 2 - canvasPoint.y * zoom,
    };
    scheduleRender();
  }

  function onEditorKeydown(event: KeyboardEvent): void {
    if (!editorOpen) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      finishEditorLine();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoEditor();
    }
  }

  function eventNear(pos: Point, hitRadius = 18): EventItem | null {
    const v = view();
    for (const ev of visibleEvents) {
      const screen = toScreen(worldToCanvas(ev, app.mapBounds, v), v);
      if (Math.hypot(screen.x - pos.x, screen.y - pos.y) <= hitRadius) {
        return ev;
      }
    }
    return null;
  }

  function vehicleNear(pos: Point): Vehicle | null {
    const v = view();
    for (const veh of visibleVehicles) {
      const screen = toScreen(worldToCanvas(veh, app.mapBounds, v), v);
      const hitRadius = app.highlightedVehicleId === veh.id ? VEHICLE_HIGHLIGHT_HIT_RADIUS : VEHICLE_HIT_RADIUS;
      if (Math.hypot(screen.x - pos.x, screen.y - pos.y) <= hitRadius) {
        return veh;
      }
    }
    return null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (editorOpen) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      editorPointerStart = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      dragged = false;
      editorDragHistoryRecorded = false;
      editorDragNodeId = editorMode === 'road' || editorMode === 'bridge' ? nearestEditorNode(pos, 12)?.id ?? null : null;
      panning = !editorDragNodeId;
      wrapper.setPointerCapture(e.pointerId);
      return;
    }
    if (placing) {
      dragged = false;
      return;
    }
    panning = true;
    dragged = false;
    last = { x: e.clientX, y: e.clientY };
    wrapper.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (editorOpen) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      editorHoverNodeId = nearestEditorNode(pos, 12, editorDragNodeId)?.id ?? null;
      if (editorDragNodeId) {
        const distance = Math.hypot(e.clientX - editorPointerStart.x, e.clientY - editorPointerStart.y);
        if (distance >= EDITOR_DRAG_PIXELS) {
          if (!editorDragHistoryRecorded) {
            recordEditorHistory();
            editorDragHistoryRecorded = true;
          }
          dragged = true;
          moveEditorNode(editorDragNodeId, pos);
        }
        scheduleRender();
        return;
      }
      if (panning) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        const distance = Math.hypot(e.clientX - editorPointerStart.x, e.clientY - editorPointerStart.y);
        if (distance >= EDITOR_DRAG_PIXELS) {
          dragged = true;
          pan = { x: pan.x + dx, y: pan.y + dy };
          last = { x: e.clientX, y: e.clientY };
        }
        scheduleRender();
        return;
      }
      editorSnapTarget = editorSnapAt(pos);
      editorCursorWorld = editorSnapTarget?.world ?? canvasToWorld(pos, app.mapBounds, view());
      scheduleRender();
      return;
    }
    if (panning) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        pan = { x: pan.x + dx, y: pan.y + dy };
        last = { x: e.clientX, y: e.clientY };
        if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
        scheduleRender();
      }
      return;
    }
    const pos = clientToCanvas(e.clientX, e.clientY);
    const ev = eventNear(pos);
    const veh = ev ? null : vehicleNear(pos);
    setHighlightedEvent(ev ? ev.id : null);
    setHighlightedVehicle(veh ? veh.id : null);
    hoverTarget = ev ? 'event' : veh ? 'vehicle' : null;
    hoverEventId = ev ? ev.id : null;
    hoverVehicleId = veh ? veh.id : null;
    hoverPos = pos;
  }

  function onPointerUp(e: PointerEvent): void {
    if (editorOpen && e.button === 0) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
      if (editorDragNodeId && dragged) {
        finishEditorNodeDrag(editorDragNodeId);
      } else if (!dragged) {
        editAt(pos);
      }
      editorDragNodeId = null;
      editorDragHistoryRecorded = false;
      editorSnapTarget = editorSnapAt(pos);
      editorCursorWorld = editorSnapTarget?.world ?? canvasToWorld(pos, app.mapBounds, view());
      panning = false;
      dragged = false;
      scheduleRender();
      return;
    }
    if (placing && e.button === 0) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      const ev = eventNear(pos);
      if (ev) openAssign(ev);
      else app.createEventPos = canvasToWorld(pos, app.mapBounds, view());
      placing = false;
      return;
    }
    if (!panning) return;
    panning = false;
    wrapper.releasePointerCapture(e.pointerId);
    if (dragged || e.button !== 0) return;
    const pos = clientToCanvas(e.clientX, e.clientY);
    const ev = eventNear(pos);
    if (ev) {
      openAssign(ev);
      return;
    }
    const veh = vehicleNear(pos);
    const assignedEvent = veh ? assignedEventForVehicle(veh.id) : undefined;
    if (assignedEvent) openAssign(assignedEvent);
  }

  function onPointerLeave(): void {
    if (editorOpen) {
      if (panning || editorDragNodeId) return;
      editorCursorWorld = null;
      editorHoverNodeId = null;
      editorSnapTarget = null;
      scheduleRender();
      return;
    }
    if (panning) return;
    setHighlightedEvent(null);
    setHighlightedVehicle(null);
    hoverTarget = null;
    hoverEventId = null;
    hoverVehicleId = null;
  }

  function onPointerCancel(e: PointerEvent): void {
    if (wrapper.hasPointerCapture(e.pointerId)) wrapper.releasePointerCapture(e.pointerId);
    panning = false;
    dragged = false;
    editorDragNodeId = null;
    editorDragHistoryRecorded = false;
    editorSnapTarget = null;
    scheduleRender();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const mouse = clientToCanvas(e.clientX, e.clientY);
    const preX = (mouse.x - pan.x) / zoom;
    const preY = (mouse.y - pan.y) / zoom;
    const factor = Math.pow(1.0015, -e.deltaY);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    pan = { x: mouse.x - preX * zoom, y: mouse.y - preY * zoom };
    scheduleRender();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (editorOpen) {
      if (editorMode === 'test') resetRouteTest();
      else finishEditorLine();
      scheduleRender();
      return;
    }
    const pos = clientToCanvas(e.clientX, e.clientY);
    const veh = vehicleNear(pos);
    if (veh) {
      openVehicleMenu(veh.id, e.clientX, e.clientY);
      return;
    }
    app.createEventPos = canvasToWorld(pos, app.mapBounds, view());
  }

  function zoomAtCenter(factor: number): void {
    if (!canvas) return;
    const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const preX = (center.x - pan.x) / zoom;
    const preY = (center.y - pan.y) / zoom;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    pan = { x: center.x - preX * zoom, y: center.y - preY * zoom };
    scheduleRender();
  }

  function resetView(): void {
    zoom = 1;
    pan = { x: 0, y: 0 };
    scheduleRender();
  }

  function toggleSet<T>(values: Set<T>, value: T): Set<T> {
    const next = new Set(values);
    if (next.has(value)) next.delete(value); else next.add(value);
    scheduleRender();
    return next;
  }

  function resetFilters(): void {
    showVehicles = true;
    showEvents = true;
    hiddenStatuses = new Set();
    hiddenCategories = new Set();
    hiddenStations = new Set();
    scheduleRender();
  }

  function onMapKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 80 : 30;
    if (e.key === '+' || e.key === '=') zoomAtCenter(1.25);
    else if (e.key === '-') zoomAtCenter(0.8);
    else if (e.key === '0') resetView();
    else if (e.key === 'ArrowLeft') pan = { x: pan.x + step, y: pan.y };
    else if (e.key === 'ArrowRight') pan = { x: pan.x - step, y: pan.y };
    else if (e.key === 'ArrowUp') pan = { x: pan.x, y: pan.y + step };
    else if (e.key === 'ArrowDown') pan = { x: pan.x, y: pan.y - step };
    else return;
    e.preventDefault();
    scheduleRender();
  }

  function render(): void {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const v = view();
    const d = imageDrawRect(v);
    if (img && natural.w && natural.h) {
      ctx.drawImage(img, d.x, d.y, d.w, d.h);
    }

    if (editorOpen && showEditorGrid && editorMapMetric) {
      const gridMeters = Number(editorGraph.grid_size_m) || 50;
      const columns = Math.floor(editorMapMetric.widthMeters / gridMeters);
      const rows = Math.floor(editorMapMetric.heightMeters / gridMeters);
      ctx.save();
      for (let column = 1; column <= columns; column += 1) {
        const meters = column * gridMeters;
        if (meters >= editorMapMetric.widthMeters) break;
        const x = d.x + meters / editorMapMetric.widthMeters * d.w;
        const major = column % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(x, d.y);
        ctx.lineTo(x, d.y + d.h);
        ctx.lineWidth = (major ? 1 : 0.6) / zoom;
        ctx.strokeStyle = major ? 'rgba(244, 239, 229, 0.32)' : 'rgba(244, 239, 229, 0.17)';
        ctx.stroke();
      }
      for (let row = 1; row <= rows; row += 1) {
        const meters = row * gridMeters;
        if (meters >= editorMapMetric.heightMeters) break;
        const y = d.y + meters / editorMapMetric.heightMeters * d.h;
        const major = row % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(d.x, y);
        ctx.lineTo(d.x + d.w, y);
        ctx.lineWidth = (major ? 1 : 0.6) / zoom;
        ctx.strokeStyle = major ? 'rgba(244, 239, 229, 0.32)' : 'rgba(244, 239, 229, 0.17)';
        ctx.stroke();
      }
      ctx.restore();
    }

    if (editorOpen) {
      const nodes = new Map(editorGraph.nodes.map((node) => [node.id, node]));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const edge of editorGraph.edges) {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) continue;
        const a = worldToCanvas(from, app.mapBounds, v);
        const b = worldToCanvas(to, app.mapBounds, v);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineWidth = 4 / zoom;
        ctx.strokeStyle = edge.kind === 'bridge' ? '#e0a04b' : '#eee8dc';
        ctx.setLineDash(edge.kind === 'bridge' ? [9 / zoom, 6 / zoom] : []);
        ctx.stroke();
        if (editorSnapTarget?.kind === 'edge' && editorSnapTarget.edgeId === edge.id) {
          ctx.setLineDash([]);
          ctx.lineWidth = 8 / zoom;
          ctx.strokeStyle = editorMode === 'unlink' ? 'rgba(232, 91, 98, 0.5)' : 'rgba(242, 181, 93, 0.42)';
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      if (editorActiveNodeId && editorCursorWorld && editorMode !== 'erase') {
        const from = nodes.get(editorActiveNodeId);
        if (from) {
          const a = worldToCanvas(from, app.mapBounds, v);
          const b = worldToCanvas(editorCursorWorld, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = 2 / zoom;
          ctx.strokeStyle = editorMode === 'bridge' ? '#e0a04b' : '#eee8dc';
          ctx.setLineDash([5 / zoom, 5 / zoom]);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const node of editorGraph.nodes) {
        const point = worldToCanvas(node, app.mapBounds, v);
        const isSnapNode = editorSnapTarget?.kind === 'node' && editorSnapTarget.nodeId === node.id;
        const isFocused = node.id === editorActiveNodeId || node.id === editorHoverNodeId || isSnapNode || node.id === editorDragNodeId;
        ctx.beginPath();
        ctx.arc(point.x, point.y, (isFocused ? 5.5 : 3.5) / zoom, 0, Math.PI * 2);
        ctx.fillStyle = isFocused ? '#f2b55d' : '#17181a';
        ctx.fill();
        ctx.lineWidth = 1.5 / zoom;
        ctx.strokeStyle = '#f4efe5';
        ctx.stroke();
      }
      if (editorSnapTarget?.kind === 'edge' && editorCursorWorld) {
        const point = worldToCanvas(editorCursorWorld, app.mapBounds, v);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 6 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#17181a';
        ctx.fill();
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = '#f2b55d';
        ctx.stroke();
      }

      if (import.meta.env.DEV && standaloneModId && editorMode === 'test' && routeTestStart) {
        const preview = routeTestPreview;
        const startSnap = preview?.startSnap ?? routeTestStartSnap;
        const testEnd = routeTestEnd;

        if (preview?.points.length) {
          ctx.beginPath();
          preview.points.forEach((point, index) => {
            const canvasPoint = worldToCanvas(point, app.mapBounds, v);
            if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
            else ctx.lineTo(canvasPoint.x, canvasPoint.y);
          });
          ctx.lineWidth = 7 / zoom;
          ctx.strokeStyle = preview.mode === 'road' ? 'rgba(224, 160, 75, 0.9)' : 'rgba(224, 160, 75, 0.42)';
          ctx.setLineDash(preview.mode === 'road' ? [] : [7 / zoom, 5 / zoom]);
          ctx.stroke();
        }

        if (preview?.mode === 'direct' && testEnd) {
          const a = worldToCanvas(routeTestStart, app.mapBounds, v);
          const b = worldToCanvas(testEnd, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = 2.5 / zoom;
          ctx.strokeStyle = 'rgba(232, 82, 74, 0.95)';
          ctx.setLineDash([8 / zoom, 5 / zoom]);
          ctx.stroke();
        }

        const connectors = [
          startSnap ? { point: routeTestStart, snap: startSnap.point } : null,
          preview && testEnd ? { point: testEnd, snap: preview.endSnap.point } : null,
        ].filter((entry): entry is { point: Point; snap: Point } => entry !== null);
        for (const connector of connectors) {
          const a = worldToCanvas(connector.point, app.mapBounds, v);
          const b = worldToCanvas(connector.snap, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = 2 / zoom;
          ctx.strokeStyle = '#f4efe5';
          ctx.setLineDash([4 / zoom, 4 / zoom]);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(b.x, b.y, 6 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#17181a';
          ctx.fill();
          ctx.lineWidth = 2 / zoom;
          ctx.strokeStyle = '#e0a04b';
          ctx.stroke();
        }

        for (const [point, color] of [[routeTestStart, '#f4efe5'], ...(testEnd ? [[testEnd, '#e0a04b']] : [])] as Array<[Point, string]>) {
          const marker = worldToCanvas(point, app.mapBounds, v);
          ctx.beginPath();
          ctx.arc(marker.x, marker.y, 7 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 2 / zoom;
          ctx.strokeStyle = '#17181a';
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      for (const issue of networkReport?.issues ?? []) {
        if (!issue.point) continue;
        const point = worldToCanvas(issue.point, app.mapBounds, v);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 10 / zoom, 0, Math.PI * 2);
        ctx.lineWidth = 3 / zoom;
        ctx.strokeStyle = issue.severity === 'error' ? '#e8524a' : '#f0a03c';
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    const vehicleOutline = cssVar('--vehicle-outline', '#dfe7ff');

    for (const ev of visibleEvents) {
      const p = worldToCanvas(ev, app.mapBounds, v);
      const markerKind: EventMarkerKind = ev.created_by === 'frontend' ? 'control-room' : eventCategory(ev.name);
      const markerColor = eventColor(markerKind);
      const isHighlighted = app.highlightedEventId === ev.id;
      const baseRadius = Math.min(12 / zoom, 12);
      const radius = isHighlighted ? baseRadius * 1.4 : baseRadius;

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = markerColor;
      ctx.fill();
      ctx.lineWidth = (isHighlighted ? 3 : 2) / zoom;
      ctx.strokeStyle = isHighlighted ? '#ffffff' : 'rgba(255, 255, 255, 0.8)';
      ctx.stroke();
      const eventIcon = eventIconFor(markerKind);
      if (eventIcon) {
        const iconSize = radius * 1.5;
        ctx.drawImage(eventIcon, p.x - iconSize / 2, p.y - iconSize / 2, iconSize, iconSize);
      }
      if (isHighlighted) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius + 6 / zoom, 0, Math.PI * 2);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = markerColor;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Fahrzeuge als Grafiken; Name und Status kommen per Hover-Tooltip
    const vehiclesToRender = [...visibleVehicles].sort(
      (a, b) => Number(a.id === app.highlightedVehicleId) - Number(b.id === app.highlightedVehicleId)
    );
    for (const veh of vehiclesToRender) {
      const p = worldToCanvas(veh, app.mapBounds, v);
      const icon = iconFor(veh);
      const isHighlighted = app.highlightedVehicleId === veh.id;

      if (icon) {
        const base = isHighlighted ? VEHICLE_ICON_HIGHLIGHT_SIZE : VEHICLE_ICON_SIZE;
        const w = Math.min(base / zoom, base);
        const h = w * (icon.naturalHeight / icon.naturalWidth);
        ctx.drawImage(icon, p.x - w / 2, p.y - h / 2, w, h);

        const statusSize = isHighlighted ? 17 : 15;
        const sq = Math.min(statusSize / zoom, statusSize);
        const sx = p.x + w / 2 - sq / 2;
        const sy = p.y + h / 2 - sq / 2;
        ctx.fillStyle = statusColor(veh.status);
        ctx.fillRect(sx, sy, sq, sq);
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeRect(sx, sy, sq, sq);
        ctx.fillStyle = '#ffffff';
        const statusFontSize = isHighlighted ? 11 : 10;
        ctx.font = `700 ${Math.min(statusFontSize / zoom, statusFontSize)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(statusDisplay(veh.status), sx + sq / 2, sy + sq / 2 + 0.5 / zoom);
        continue;
      }

      const markerSize = isHighlighted ? 15 : 13;
      const offset = Math.min(markerSize / zoom, markerSize);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - offset);
      ctx.lineTo(p.x + offset, p.y);
      ctx.lineTo(p.x, p.y + offset);
      ctx.lineTo(p.x - offset, p.y);
      ctx.closePath();
      ctx.fillStyle = statusColor(veh.status);
      ctx.fill();
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeStyle = vehicleOutline;
      ctx.stroke();
    }

    ctx.restore();
  }
</script>

<svelte:window onkeydown={onEditorKeydown} />

<section class="panel map-panel">
  <div class="panel-header">
    <span class="icon"><MapIcon size={14} /></span>
    <h2>{standaloneModId ? `Straßeneditor · ${standaloneModId}` : 'Karte'}</h2>
    <span class="spacer"></span>
    <span class="hint">{standaloneModId ? 'Die Linien sind nur im Editor sichtbar' : 'Scrollen: Zoom · Verschieben-Schalter: Pfeiltasten'}</span>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="map-wrapper"
    class:pointer={hoverTarget !== null}
    class:panning
    bind:this={wrapper}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
    onpointerleave={onPointerLeave}
    onwheel={onWheel}
    oncontextmenu={onContextMenu}
    role="application"
    aria-label="Einsatzkarte"
    class:placing
    class:editor-active={editorOpen}
    class:node-hover={editorOpen && editorHoverNodeId !== null}
  >
    <canvas bind:this={canvas}></canvas>
    <div class="map-controls" role="toolbar" aria-label="Kartensteuerung">
      <button data-tooltip="Vergrößern" aria-label="Karte vergrößern" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => zoomAtCenter(1.25)}><Plus size={15} /></button>
      <button data-tooltip="Verkleinern" aria-label="Karte verkleinern" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => zoomAtCenter(0.8)}><Minus size={15} /></button>
      <button data-tooltip="Karte einpassen" aria-label="Karte einpassen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={resetView}><Crosshair size={15} /></button>
      <button data-tooltip="Karte mit Pfeiltasten verschieben" aria-label="Karte mit Pfeiltasten verschieben" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onkeydown={onMapKeydown}><Move size={15} /></button>
      {#if editorAvailable}
        <button class:active={editorOpen} aria-pressed={editorOpen} data-tooltip="Straßennetz bearbeiten" aria-label="Straßennetz bearbeiten" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => editorOpen ? void closeEditor() : openEditor()}><Route size={15} /></button>
      {/if}
      {#if !standaloneModId}
        <button class="create-event" class:active={placing} aria-pressed={placing} disabled={editorOpen} data-tooltip="Einsatz auf der Karte anlegen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => (placing = !placing)}><MapPin size={15} /> Einsatz anlegen</button>
        <button class:active={filtersOpen} aria-pressed={filtersOpen} disabled={editorOpen} data-tooltip="Kartenfilter" aria-label="Kartenfilter öffnen" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={() => (filtersOpen = !filtersOpen)}><SlidersHorizontal size={15} /></button>
      {/if}
    </div>
    {#if editorOpen}
      <div class="route-editor" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} oncontextmenu={(e) => e.stopPropagation()} role="dialog" aria-label="Straßennetz bearbeiten" tabindex="-1">
        <div class="route-editor-head">
          <strong>Straßennetz</strong>
          <span>{editorGraph.edges.length} Abschnitte</span>
          <button class="ghost" data-tooltip="Editor schließen" aria-label="Editor schließen" onclick={() => void closeEditor()}><X size={14} /></button>
        </div>
        <div class="route-tools" role="toolbar" aria-label="Zeichenwerkzeuge">
          <button class:active={editorMode === 'road'} aria-pressed={editorMode === 'road'} onclick={() => setEditorMode('road')}><Route size={14} /> Straße</button>
          <button class:active={editorMode === 'bridge'} aria-pressed={editorMode === 'bridge'} onclick={() => setEditorMode('bridge')}><Construction size={14} /> Brücke</button>
          <button class:active={editorMode === 'unlink'} aria-pressed={editorMode === 'unlink'} onclick={() => setEditorMode('unlink')}><Unlink size={14} /> Verbindung</button>
          <button class:active={editorMode === 'erase'} aria-pressed={editorMode === 'erase'} onclick={() => setEditorMode('erase')}><Eraser size={14} /> Punkt</button>
          {#if standaloneModId}<button class:active={editorMode === 'test'} aria-pressed={editorMode === 'test'} onclick={() => setEditorMode('test')}><Crosshair size={14} /> Test</button>{/if}
        </div>
        {#if editorMode === 'test'}
          <p>Klicke zuerst den Start und danach das Ziel. Weiß gestrichelt ist der Anschluss zur nächsten Straße, Orange ist die berechnete Route.</p>
          {#if routeTestPreview}
            <div class="route-test-result" class:fallback={routeTestPreview.fallback}>
              <div>
                <strong>{formatDistance(routeTestPreview)}</strong>
                <span>Anschluss Start {Math.round(routeTestPreview.startSnap.connectorMeters)} m · Ziel {Math.round(routeTestPreview.endSnap.connectorMeters)} m</span>
              </div>
              <button class="ghost" aria-label="Routentest zurücksetzen" data-tooltip="Routentest zurücksetzen" onclick={resetRouteTest}><X size={14} /></button>
            </div>
          {:else if routeTestStart}
            <div class="route-test-result">
              <div>
                <strong>Start gesetzt</strong>
                <span>{routeTestStartSnap ? `Nächster Straßenpunkt: ${Math.round(routeTestStartSnap.connectorMeters)} m` : 'Das Straßennetz ist leer.'}</span>
              </div>
              <button class="ghost" aria-label="Routentest zurücksetzen" data-tooltip="Routentest zurücksetzen" onclick={resetRouteTest}><X size={14} /></button>
            </div>
          {/if}
        {:else if editorMode === 'unlink'}
          <p>Klicke auf eine Straßen- oder Brückenverbindung. Nur dieser Abschnitt wird entfernt; angrenzende Verbindungen bleiben bestehen.</p>
        {:else if editorMode === 'erase'}
          <p>Klicke auf einen Punkt. Seine direkt angeschlossenen Abschnitte werden ebenfalls entfernt.</p>
        {:else}
          <p>Klick zeichnet. Punkt ziehen verschiebt ihn, freie Fläche ziehen bewegt die Karte. Straßen kreuzen sich als Knoten; Brücken nur an eingerasteten Endpunkten.</p>
        {/if}
        {#if standaloneModId}
          <div class="calibration-fields">
            <label for="map-width-px">Texturbreite (px)</label>
            <input id="map-width-px" type="number" min="1" max="100000" step="1" value={editorGraph.map_width_px ?? natural.w} oninput={(event) => updateEditorMetric('map_width_px', event.currentTarget.value)} />
            <label for="map-height-px">Texturhöhe (px)</label>
            <input id="map-height-px" type="number" min="1" max="100000" step="1" value={editorGraph.map_height_px ?? natural.h} oninput={(event) => updateEditorMetric('map_height_px', event.currentTarget.value)} />
            <label for="pixels-per-meter">Pixel pro Meter</label>
            <input id="pixels-per-meter" type="number" min="0.01" max="10000" step="0.1" value={editorGraph.pixels_per_meter ?? ''} oninput={(event) => updateEditorMetric('pixels_per_meter', event.currentTarget.value)} />
            <label for="grid-size-m">Rasterweite</label>
            <div class="grid-setting">
              <input id="grid-size-m" type="number" min="1" max="1000" step="5" value={editorGraph.grid_size_m ?? 50} oninput={(event) => updateEditorMetric('grid_size_m', event.currentTarget.value)} />
              <span>m</span>
              <label class="grid-toggle"><input type="checkbox" bind:checked={showEditorGrid} onchange={scheduleRender} /> <Grid3X3 size={13} /> anzeigen</label>
            </div>
            {#if editorMapMetric}
              <span class="metric-summary">
                {editorMapMetric.widthMeters.toLocaleString('de-DE', { maximumFractionDigits: 1 })} × {editorMapMetric.heightMeters.toLocaleString('de-DE', { maximumFractionDigits: 1 })} m · {editorMapMetric.areaSquareKilometers.toLocaleString('de-DE', { maximumFractionDigits: 3 })} km²
              </span>
            {/if}
          </div>
        {:else}
          <div class="scale-field">
            <label for="routing-scale">Meter je Spielkoordinate</label>
            <input id="routing-scale" type="number" min="0.001" max="10" step="0.01" value={editorGraph.meters_per_world_unit} oninput={(event) => updateEditorScale(event.currentTarget.value)} />
            <span>Aktuell: 10 Koordinaten = {(editorGraph.meters_per_world_unit * 10).toLocaleString('de-DE', { maximumFractionDigits: 2 })} m</span>
          </div>
        {/if}
        {#if editorError}<div class="route-error" role="alert">{editorError}</div>{/if}
        {#if networkReport}
          <div class="network-report" class:has-errors={networkReport.issues.some((issue) => issue.severity === 'error')}>
            <div class="network-summary">
              <strong>{networkReport.issues.length ? `${networkReport.issues.length} Befunde` : 'Netz ohne Befund'}</strong>
              <span>{networkReport.components} Teilnetz(e) · {networkReport.deadEnds} Endpunkte · {networkReport.crossings} offene Kreuzungen</span>
            </div>
            {#each networkReport.issues.slice(0, 8) as issue (`${issue.code}-${issue.message}`)}
              <button class="network-issue {issue.severity}" disabled={!issue.point} onclick={() => focusNetworkIssue(issue.point)}>
                <span>{issue.message}</span>
                {#if issue.point}<Crosshair size={12} />{/if}
              </button>
            {/each}
            {#if networkReport.issues.length > 8}<span class="network-more">+{networkReport.issues.length - 8} weitere Befunde</span>{/if}
          </div>
        {/if}
        <div class="route-actions">
          <input class="routing-file-input" bind:this={importInput} type="file" accept=".json,application/json" onchange={(event) => void importEditorFile(event)} />
          <button disabled={!editorHistory.length} data-tooltip="Rückgängig" aria-label="Letzte Änderung rückgängig" onclick={undoEditor}><Undo2 size={14} /></button>
          <button disabled={!editorActiveNodeId} onclick={finishEditorLine}><Check size={14} /> Linie beenden</button>
          <button class="danger-text" disabled={!editorGraph.edges.length} data-tooltip="Alles löschen" aria-label="Gesamtes Straßennetz löschen" onclick={() => void clearEditor()}><Trash2 size={14} /></button>
          <button onclick={runNetworkCheck}><ShieldCheck size={14} /> Netz prüfen</button>
          <button onclick={() => importInput?.click()}><Upload size={14} /> JSON laden</button>
          <button class="save-route" disabled={!editorDirty || editorSaving || (!standaloneModId && !canWrite())} onclick={() => void saveEditor()}><Save size={14} /> {editorSaving ? 'Speichert …' : 'Speichern'}</button>
        </div>
      </div>
    {/if}
    {#if filtersOpen}
      <div class="map-filters" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} oncontextmenu={(e) => e.stopPropagation()} role="dialog" aria-label="Kartenfilter" tabindex="-1">
        <div class="filter-head"><strong>Kartenfilter</strong><button class="ghost" data-tooltip="Schließen" aria-label="Kartenfilter schließen" onclick={() => (filtersOpen = false)}><X size={14} /></button></div>
        <div class="filter-section two">
          <label><input type="checkbox" bind:checked={showVehicles} onchange={scheduleRender} /> Fahrzeuge</label>
          <label><input type="checkbox" bind:checked={showEvents} onchange={scheduleRender} /> Einsätze</label>
        </div>
        <div class="filter-section"><span>Status</span><div class="options statuses">
          {#each STATUS_LABELS as label, status (status)}
            <label data-tooltip={label}><input type="checkbox" checked={!hiddenStatuses.has(status)} onchange={() => (hiddenStatuses = toggleSet(hiddenStatuses, status))} /><StatusBadge value={status} /></label>
          {/each}
        </div></div>
        <div class="filter-section"><span>Einsatzarten</span><div class="options categories">
          {#each CATEGORIES as category (category)}
            <label><input type="checkbox" checked={!hiddenCategories.has(category)} onchange={() => (hiddenCategories = toggleSet(hiddenCategories, category))} /><i style={`background: ${eventColor(category)}`}></i>{CATEGORY_LABELS[category]}</label>
          {/each}
        </div></div>
        <div class="filter-section"><span>Wachen</span><div class="options stations">
          {#each stations as stationName (stationName)}
            <label><input type="checkbox" checked={!hiddenStations.has(stationName)} onchange={() => (hiddenStations = toggleSet(hiddenStations, stationName))} />{stationName}</label>
          {/each}
        </div></div>
        <button class="reset-filter" onclick={resetFilters}>Alle anzeigen</button>
      </div>
    {/if}
    {#if tooltipEvent}
      <div class="map-tooltip" style="left: {eventTooltipPosition.x + 14}px; top: {eventTooltipPosition.y + 14}px;">
        <span class="tt-name">{tooltipEvent.name || 'Einsatz'}</span>
      </div>
    {:else if tooltipVehicle}
      <div class="map-tooltip" style="left: {vehicleTooltipPosition.x + 14}px; top: {vehicleTooltipPosition.y + 14}px;">
        <span class="tt-name">{tooltipVehicle.name || tooltipVehicle.type || tooltipVehicle.game_vehicle_id}</span>
        <StatusBadge value={tooltipVehicle.status} />
      </div>
    {/if}
    {#if !app.mapImageUrl}
      <div class="map-placeholder">
        {#if app.sessionToken}
          Kein Kartenbild für diese Sitzung
        {:else}
          Sitzungs-Token oben rechts eintragen
        {/if}
      </div>
    {/if}
    {#if scaleBar && !standaloneModId}
      <div class="map-scale" aria-label={`Kartenmaßstab ${scaleBar.meters} Meter`}>
        <span style={`width: ${scaleBar.pixels}px`}></span>
        <b>{scaleBar.meters >= 1000 ? `${(scaleBar.meters / 1000).toLocaleString('de-DE')} km` : `${scaleBar.meters.toLocaleString('de-DE')} m`}</b>
      </div>
    {/if}
  </div>
  {#if !standaloneModId}<div class="legend">
    <span class="chip"><span class="dot event"></span> Einsatz</span>
    <span class="chip"><span class="dot vehicle"></span> Fahrzeug</span>
    <details class="status-help">
      <summary>Statuslegende</summary>
      <div class="status-popover">
        {#each STATUS_LABELS as label, status (label)}
          <span><StatusBadge value={status} /> {label}</span>
        {/each}
      </div>
    </details>
  </div>{/if}
</section>

<style>
  .map-panel {
    height: 100%;
  }

  .hint {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: none;
    letter-spacing: normal;
  }

  .map-wrapper {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: #0e0f11;
    cursor: grab;
    touch-action: none;
  }

  .map-wrapper.pointer {
    cursor: pointer;
  }

  .map-wrapper.panning {
    cursor: grabbing;
  }

  .map-wrapper.placing { cursor: crosshair; }
  .map-wrapper.editor-active { cursor: crosshair; }
  .map-wrapper.editor-active.node-hover { cursor: move; }
  .map-wrapper.editor-active.panning { cursor: grabbing; }

  .map-controls { position: absolute; top: 10px; right: 10px; display: flex; gap: 4px; z-index: 6; }
  .map-controls button { min-width: 30px; height: 30px; padding: 0 7px; justify-content: center; background: rgba(21, 22, 25, 0.94); }
  .map-controls button.active { border-color: var(--accent-outline); background: #25282d; }
  .route-editor { position: absolute; top: 10px; left: 10px; z-index: 7; width: min(430px, calc(100% - 74px)); max-height: calc(100% - 20px); overflow: auto; border: 1px solid var(--border-strong); background: rgba(21, 22, 25, 0.98); box-shadow: var(--shadow); cursor: default; }
  .route-editor-head { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-bottom: 1px solid var(--border); }
  .route-editor-head strong { font-size: 12px; }
  .route-editor-head span { flex: 1; color: var(--text-dim); font-size: 11px; }
  .route-tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 8px; border-bottom: 1px solid var(--border); }
  .route-tools button { justify-content: center; font-size: 11px; }
  .route-tools button.active { border-color: #b98443; background: rgba(185, 132, 67, 0.16); color: #f3c98f; }
  .route-editor p { margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 11px; line-height: 1.45; }
  .route-test-result { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); border-left: 3px solid #e0a04b; }
  .route-test-result.fallback { border-left-color: var(--danger); }
  .route-test-result > div { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; }
  .route-test-result strong { font-size: 11px; }
  .route-test-result span { color: var(--text-dim); font-size: 10px; }
  .scale-field { display: grid; grid-template-columns: 1fr 92px; gap: 5px 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .scale-field label { color: var(--text); font-size: 11px; }
  .scale-field input { width: 100%; }
  .scale-field span { grid-column: 1 / -1; color: var(--text-dim); font-size: 10px; }
  .calibration-fields { display: grid; grid-template-columns: 1fr 172px; gap: 6px 8px; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .calibration-fields > label { color: var(--text); font-size: 11px; }
  .calibration-fields > input { width: 100%; }
  .grid-setting { display: grid; grid-template-columns: 58px 12px 1fr; gap: 4px; align-items: center; }
  .grid-setting > input { width: 100%; }
  .grid-setting > span { color: var(--text-dim); font-size: 10px; }
  .grid-toggle { display: flex; align-items: center; gap: 4px; color: var(--text-dim); font-size: 10px; white-space: nowrap; }
  .metric-summary { grid-column: 1 / -1; padding-top: 2px; color: var(--text-dim); font-size: 10px; }
  .route-error { padding: 7px 10px; border-bottom: 1px solid var(--border); border-left: 3px solid var(--danger); color: var(--danger-text); font-size: 11px; }
  .network-report { border-bottom: 1px solid var(--border); border-left: 3px solid var(--warn); }
  .network-report.has-errors { border-left-color: var(--danger); }
  .network-summary { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
  .network-summary strong { font-size: 11px; }
  .network-summary span, .network-more { color: var(--text-dim); font-size: 10px; }
  .network-issue { width: 100%; justify-content: space-between; border: 0; border-top: 1px solid var(--border); border-radius: 0; background: transparent; color: var(--warn-text); font-size: 10px; text-align: left; white-space: normal; }
  .network-issue.error { color: var(--danger-text); }
  .network-issue:disabled { opacity: 1; cursor: default; }
  .network-more { display: block; padding: 6px 10px; border-top: 1px solid var(--border); }
  .route-actions { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px; }
  .route-actions button { padding-inline: 7px; font-size: 11px; }
  .route-actions .save-route { margin-left: auto; }
  .route-actions .danger-text { color: var(--danger-text); }
  .routing-file-input { display: none; }
  .map-filters { position: absolute; top: 48px; right: 10px; z-index: 7; width: min(330px, calc(100% - 20px)); max-height: calc(100% - 62px); overflow: auto; padding: 10px; border: 1px solid var(--border-strong); background: rgba(21, 22, 25, 0.98); box-shadow: var(--shadow); cursor: default; }
  .filter-head { display: flex; align-items: center; padding-bottom: 7px; border-bottom: 1px solid var(--border); } .filter-head strong { flex: 1; font-size: 12px; }
  .filter-section { padding: 9px 0; border-bottom: 1px solid var(--border); } .filter-section > span { display: block; margin-bottom: 7px; color: var(--text-dim); font-size: 10px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; }
  .filter-section.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .filter-section label { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; }
  .options { display: grid; gap: 6px; } .options.statuses { grid-template-columns: repeat(5, 1fr); } .options.categories { grid-template-columns: 1fr 1fr; } .options.stations { grid-template-columns: 1fr 1fr; }
  .options.statuses label { justify-content: center; } .options i { width: 8px; height: 8px; flex: 0 0 auto; }
  .reset-filter { width: 100%; margin-top: 9px; justify-content: center; font-size: 11px; }

  canvas {
    position: absolute;
    inset: 0;
  }

  .map-tooltip {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 9px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }

  .map-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 13px;
    pointer-events: none;
  }

  .map-scale { position: absolute; left: 12px; bottom: 10px; z-index: 4; min-width: 50px; padding: 4px 6px; background: rgba(14, 15, 17, 0.82); color: #f3f0e9; pointer-events: none; }
  .map-scale span { display: block; height: 5px; border: 1px solid currentColor; border-top: 0; }
  .map-scale b { display: block; margin-top: 2px; font-size: 10px; font-weight: 600; text-align: center; }

  .legend {
    display: flex;
    gap: 12px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
    flex: 0 0 auto;
  }

  .status-help { margin-left: auto; position: relative; }
  .status-help summary { cursor: pointer; color: var(--text-dim); }
  .status-help summary:hover, .status-help summary:focus-visible { color: var(--text); }
  .status-popover { position: absolute; right: 0; bottom: calc(100% + 8px); width: 210px; padding: 8px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow); display: grid; gap: 5px; z-index: 8; }
  .status-popover > span { display: flex; align-items: center; gap: 8px; color: var(--text); }

  @media (max-width: 620px) {
    .hint { display: none; }
    .map-controls .create-event { font-size: 0; width: 30px; }
    .map-controls .create-event :global(svg) { margin: 0; }
    .route-editor { top: 48px; width: calc(100% - 20px); }
    .route-actions button:not(.save-route) { font-size: 0; }
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }

  .dot.event {
    background: var(--accent);
    border: 1px solid var(--accent-outline);
  }

  .dot.vehicle {
    background: var(--good);
    border: 1px solid var(--vehicle-outline);
    border-radius: 2px;
    transform: rotate(45deg);
  }
</style>
