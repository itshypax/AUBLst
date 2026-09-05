<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, Construction, Crosshair, Eraser, Grid3X3, Route, Save, ShieldCheck, Trash2, Undo2, Unlink, Upload, X } from '../lib/fontawesome-icons';
  import { untrack } from 'svelte';
  import { api } from '../lib/api';
  import { eventCategory, station, type EventCategory } from '../lib/classify';
  import { dismissibleDetails } from '../lib/dismissible-details';
  import { MapLayerScheduler, drawMarkerLayer, type MapLayer } from '../lib/map-layers';
  import { canvasToWorld, imageDrawRect, mapContentDrawRect, screenPointInMapContent, toScreen, worldToCanvas, type MapView, type Point } from '../lib/mapview';
  import { cloneRoutingConfig, formatDistance, nearestRoadSnap, parseRoutingConfig, roadLocationLabel, roadRoutePreview, validateRoutingNetwork, type BmaZone, type RoadEdge, type RoadKind, type RoadNode, type RoadRoutePreview, type RoadSnap, type RoutingConfig, type RoutingNetworkReport } from '../lib/routing';
  import { app, askConfirm, assignedEventForVehicle, canWrite, openAssign, openVehicleMenu, setHighlightedEvent, setHighlightedVehicle, showNotice } from '../lib/state.svelte';
  import { statusCode, statusDisplay } from '../lib/status';
  import { loadVehicleIconManifest, vehicleIconPath, type VehicleIconManifest } from '../lib/vehicleIcons';
  import type { EventItem, Vehicle } from '../lib/types';
  import type { MapFilterSettings } from '../lib/workspaces';
  import StatusBadge from './StatusBadge.svelte';
  import MapFilters from './map/MapFilters.svelte';
  import MapToolbar from './map/MapToolbar.svelte';

  let {
    standaloneModId = null,
    filterSettings = null,
    onFilterSettingsChange,
  }: {
    standaloneModId?: string | null;
    filterSettings?: MapFilterSettings | null;
    onFilterSettingsChange?: (filters: MapFilterSettings) => void;
  } = $props();

  let wrapper: HTMLDivElement;
  let baseCanvas: HTMLCanvasElement;
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

  // Filter aus dem Layout übernehmen. Änderungen im Filterfenster gehen über
  // onFilterSettingsChange zurück ins Layout, damit jede Karte ihre eigenen
  // Filter behält.
  function applyFilterSettings(settings: MapFilterSettings | null): void {
    showVehicles = settings?.showVehicles ?? true;
    showEvents = settings?.showEvents ?? true;
    hiddenStatuses = new Set(settings?.hiddenStatuses ?? []);
    hiddenCategories = new Set((settings?.hiddenCategories ?? []) as EventCategory[]);
    hiddenStations = new Set(settings?.hiddenStations ?? []);
  }

  function emitFilterSettings(): void {
    onFilterSettingsChange?.({
      showVehicles,
      showEvents,
      hiddenStatuses: [...hiddenStatuses],
      hiddenCategories: [...hiddenCategories],
      hiddenStations: [...hiddenStations],
    });
  }

  $effect(() => {
    const settings = filterSettings;
    untrack(() => applyFilterSettings(settings));
  });
  let canvasSize = $state({ w: 0, h: 0 });
  let editorOpen = $state(false);
  type EditorMode = RoadKind | 'erase' | 'unlink' | 'test' | 'bma' | 'street-name';
  let editorMode = $state<EditorMode>('road');
  let editorGraph = $state<RoutingConfig>(cloneRoutingConfig(app.routing));
  let editorHistory = $state<RoutingConfig[]>([]);
  let editorActiveNodeId = $state<string | null>(null);
  let editorCursorWorld = $state<Point | null>(null);
  let editorHoverNodeId = $state<string | null>(null);
  let editorDragNodeId = $state<string | null>(null);
  let editorDragHistoryRecorded = false;
  let editorPointerStart = { x: 0, y: 0 };
  let editorStreetPickStart: Point | null = null;
  type EditorSnapTarget =
    | { kind: 'node'; nodeId: string; world: Point }
    | { kind: 'edge'; edgeId: string; t: number; world: Point }
    | null;
  let editorSnapTarget = $state<EditorSnapTarget>(null);
  let selectedStreetEdgeIds = $state<string[]>([]);
  let selectedStreetEdgeId = $state<string | null>(null);
  let selectedStreetEdgePoint = $state<{ t: number; world: Point } | null>(null);
  let streetNameDraft = $state('');
  let showEditorGrid = $state(true);
  let editorDirty = $state(false);
  let editorSaving = $state(false);
  let editorError = $state('');
  let bmaDraftName = $state('');
  let bmaDraftPoints = $state<Point[]>([]);
  let editingBmaZoneId = $state<string | null>(null);
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
  const visibleEvents = $derived(showEvents ? app.events.filter((event) => event.status === 'active' && !hiddenCategories.has(eventCategory(event.name))) : []);
  const visibleVehicles = $derived(showVehicles ? app.vehicles.filter((vehicle) => !hiddenStatuses.has(Number(vehicle.status)) && !hiddenStations.has(station(vehicle))) : []);
  const hoverEvent = $derived(visibleEvents.find((event) => event.id === hoverEventId) ?? null);
  const tooltipEvent = $derived(hoverEvent ?? visibleEvents.find((event) => event.id === app.highlightedEventId) ?? null);
  const hoverVehicle = $derived(visibleVehicles.find((v) => v.id === hoverVehicleId) ?? null);
  const tooltipVehicle = $derived(hoverVehicle ?? visibleVehicles.find((v) => v.id === app.highlightedVehicleId) ?? null);
  const selectedStreetEdge = $derived(editorGraph.edges.find((edge) => edge.id === selectedStreetEdgeId) ?? null);
  const selectedStreetEdgeCount = $derived(selectedStreetEdgeIds.length);
  const namedStreetEdgeCount = $derived(editorGraph.edges.filter((edge) => Boolean(edge.name?.trim())).length);
  const eventTooltipPosition = $derived.by(() => {
    if (!tooltipEvent || !canvas || hoverEvent) return hoverPos;
    return toScreen(worldToCanvas(tooltipEvent, app.mapBounds, view()), view());
  });
  const vehicleTooltipPosition = $derived.by(() => {
    if (!tooltipVehicle || !canvas || hoverVehicle) return hoverPos;
    return toScreen(worldToCanvas(tooltipVehicle, app.mapBounds, view()), view());
  });
  const STATUS_LABELS = ['Alarmiert', 'Einsatzbereit Funk', 'Einsatzbereit Wache', 'Einsatz übernommen', 'An Einsatzstelle', 'Sprechwunsch', 'Nicht einsatzbereit', 'Patient aufgenommen', 'Am Transportziel'];
  type EventMarkerKind = EventCategory | 'control-room';

  const scaleBar = $derived.by(() => {
    const routing = editorOpen ? editorGraph : app.routing;
    const scale = Number(routing.meters_per_world_unit_x ?? routing.meters_per_world_unit);
    const worldWidth = app.mapBounds.max_x - app.mapBounds.min_x;
    if (!canvas || canvasSize.w <= 0 || !Number.isFinite(scale) || scale <= 0 || worldWidth <= 0) return null;
    const drawWidth = mapContentDrawRect(view()).w * zoom;
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
  let vehicleIconManifest = $state<VehicleIconManifest | null>(null);
  let vehicleIconManifestGeneration = 0;

  function iconFor(v: Vehicle): HTMLImageElement | null {
    const src = vehicleIconPath(v, vehicleIconManifest);
    if (!src) return null;
    let image = iconCache.get(src);
    if (!image) {
      image = new Image();
      image.onload = () => scheduleRender('markers');
      image.src = src;
      iconCache.set(src, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  const MIN_ZOOM = 0.2;
  const MAX_CONTROL_ROOM_ZOOM = 6;
  const MAX_EDITOR_ZOOM = 4;
  const maximumZoom = $derived(standaloneModId ? MAX_EDITOR_ZOOM : MAX_CONTROL_ROOM_ZOOM);
  const EDITOR_SNAP_PIXELS = 17;
  const EDITOR_DRAG_PIXELS = 4;
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
    const code = statusCode(status);
    return cssVar(`--status-${code ?? status}-start`, cssVar('--good', '#2ec98e'));
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
      image.onload = () => scheduleRender('markers');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${eventIconNodes[kind]}</svg>`;
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      eventIconCache.set(kind, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }

  function view(): MapView {
    return { zoom, pan, natural, contentRect: app.mapContentRect, width: canvas.clientWidth, height: canvas.clientHeight };
  }

  const layers = new MapLayerScheduler((which) => drawLayers(which));
  // Ohne Argument werden beide Ebenen neu gezeichnet. Zustandsupdates aus dem
  // Spiel markieren nur die Markerebene, damit das Kartenbild stehen bleibt.
  function scheduleRender(...which: MapLayer[]): void {
    layers.invalidate(...which);
  }

  $effect(() => {
    const modId = standaloneModId || app.modId;
    const generation = ++vehicleIconManifestGeneration;
    vehicleIconManifest = null;
    iconCache.clear();
    scheduleRender('markers');
    if (!modId) return;
    void loadVehicleIconManifest(modId).then((manifest) => {
      if (generation !== vehicleIconManifestGeneration) return;
      vehicleIconManifest = manifest;
      scheduleRender('markers');
    });
  });

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
    if (!canvas || !baseCanvas || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    for (const target of [baseCanvas, canvas]) {
      target.style.width = `${rect.width}px`;
      target.style.height = `${rect.height}px`;
      target.width = Math.max(1, Math.floor(rect.width * ratio));
      target.height = Math.max(1, Math.floor(rect.height * ratio));
    }
    canvasSize = { w: rect.width, h: rect.height };
    layers.drawNow();
  }

  // untrack, sonst hängt dieser Effekt an allem, was beim Zeichnen gelesen
  // wird, und würde bei jedem Zustandsupdate den Observer neu anlegen und
  // beide Ebenen neu zeichnen.
  $effect(() => {
    const observer = new ResizeObserver(() => scheduleResize());
    observer.observe(wrapper);
    untrack(() => resize());
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

  // Kartengrenzen ändern die Projektion, also beide Ebenen.
  $effect(() => {
    void app.mapBounds;
    void app.mapContentRect;
    scheduleRender();
  });

  // Fahrzeuge, Einsätze und Hervorhebungen liegen nur auf der Markerebene.
  $effect(() => {
    void app.vehicles;
    void app.positionRevision;
    void app.events;
    void app.highlightedEventId;
    void app.highlightedVehicleId;
    void visibleEvents;
    void visibleVehicles;
    scheduleRender('markers');
  });

  $effect(() => {
    void editorOpen;
    void editorMode;
    void editorGraph;
    void editorSnapTarget;
    void selectedStreetEdgeCount;
    scheduleRender('base');
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

  function clearStreetEdgeSelection(): void {
    selectedStreetEdgeIds = [];
    selectedStreetEdgeId = null;
    selectedStreetEdgePoint = null;
    streetNameDraft = '';
  }

  function syncStreetNameDraft(edgeIds: string[]): void {
    const names = editorGraph.edges
      .filter((edge) => edgeIds.includes(edge.id))
      .map((edge) => edge.name ?? '');
    streetNameDraft = names.length > 0 && names.every((name) => name === names[0]) ? names[0] : '';
  }

  function openEditor(): void {
    editorGraph = cloneRoutingConfig(app.routing);
    editorHistory = [];
    editorActiveNodeId = null;
    editorCursorWorld = null;
    editorHoverNodeId = null;
    editorDragNodeId = null;
    editorSnapTarget = null;
    clearStreetEdgeSelection();
    showEditorGrid = true;
    editorDirty = false;
    editorError = '';
    bmaDraftName = '';
    bmaDraftPoints = [];
    editingBmaZoneId = null;
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
    clearStreetEdgeSelection();
    editorError = '';
    scheduleRender();
  }

  function undoEditor(): void {
    const previous = editorHistory.at(-1);
    if (!previous) return;
    editorGraph = cloneRoutingConfig(previous);
    editorHistory = editorHistory.slice(0, -1);
    editorActiveNodeId = null;
    clearStreetEdgeSelection();
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
    if (mode !== 'street-name') clearStreetEdgeSelection();
    if (mode !== 'test') resetRouteTest();
    scheduleRender();
  }

  function addBmaPoint(pos: Point): void {
    bmaDraftPoints = [...bmaDraftPoints, canvasToWorld(pos, app.mapBounds, view())];
    scheduleRender();
  }

  function undoBmaPoint(): void {
    if (!bmaDraftPoints.length) return;
    bmaDraftPoints = bmaDraftPoints.slice(0, -1);
    scheduleRender();
  }

  function cancelBmaEdit(): void {
    editingBmaZoneId = null;
    bmaDraftName = '';
    bmaDraftPoints = [];
    editorError = '';
    scheduleRender();
  }

  function editBmaZone(zone: BmaZone): void {
    editorMode = 'bma';
    editingBmaZoneId = zone.id;
    bmaDraftName = zone.name;
    bmaDraftPoints = zone.points.map((point) => ({ ...point }));
    editorActiveNodeId = null;
    editorSnapTarget = null;
    editorError = '';
    scheduleRender();
  }

  function saveBmaZone(): void {
    const name = bmaDraftName.trim();
    if (!name) {
      editorError = 'Bitte zuerst eine Bezeichnung für die BMA-Zone eingeben.';
      return;
    }
    if (bmaDraftPoints.length < 3) {
      editorError = 'Eine BMA-Zone benötigt mindestens drei Punkte.';
      return;
    }
    recordEditorHistory();
    const zone = {
      id: editingBmaZoneId ?? `bma_${Date.now().toString(36)}_${(++routeIdCounter).toString(36)}`,
      name,
      points: bmaDraftPoints.map((point) => ({ ...point })),
    };
    editorGraph = {
      ...editorGraph,
      bma_zones: editingBmaZoneId
        ? (editorGraph.bma_zones ?? []).map((entry) => entry.id === editingBmaZoneId ? zone : entry)
        : [...(editorGraph.bma_zones ?? []), zone],
    };
    cancelBmaEdit();
    editorDirty = true;
    scheduleRender();
  }

  async function removeBmaZone(id: string, name: string): Promise<void> {
    if (!await askConfirm(`BMA-Zone „${name}“ löschen?`)) return;
    recordEditorHistory();
    editorGraph = { ...editorGraph, bma_zones: (editorGraph.bma_zones ?? []).filter((zone) => zone.id !== id) };
    if (editingBmaZoneId === id) cancelBmaEdit();
    editorDirty = true;
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
      { id: editorId('e'), from: match.edge.from, to: node.id, kind: match.edge.kind, ...(match.edge.name ? { name: match.edge.name } : {}) },
      { id: editorId('e'), from: node.id, to: match.edge.to, kind: match.edge.kind, ...(match.edge.name ? { name: match.edge.name } : {}) },
    ];
    return node;
  }

  function edgeExists(from: string, to: string, kind: RoadKind): boolean {
    return editorGraph.edges.some((edge) => edge.kind === kind && (
      (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)
    ));
  }

  function appendEdge(from: string, to: string, kind: RoadKind, name?: string): void {
    if (from === to || edgeExists(from, to, kind)) return;
    editorGraph.edges = [...editorGraph.edges, { id: editorId('e'), from, to, kind, ...(name ? { name } : {}) }];
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
    appendEdge(edge.from, nodeId, edge.kind, edge.name);
    appendEdge(nodeId, edge.to, edge.kind, edge.name);
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

  function selectStreetEdge(pos: Point): void {
    const match = nearestEditorEdge(pos, 14);
    if (!match) {
      clearStreetEdgeSelection();
      scheduleRender();
      return;
    }
    let next: string[];
    if (selectedStreetEdgeIds.includes(match.edge.id)) {
      next = selectedStreetEdgeIds.filter((edgeId) => edgeId !== match.edge.id);
      if (selectedStreetEdgeId === match.edge.id) {
        selectedStreetEdgeId = null;
        selectedStreetEdgePoint = null;
      }
    } else {
      next = [...selectedStreetEdgeIds, match.edge.id];
      selectedStreetEdgeId = match.edge.id;
      selectedStreetEdgePoint = { t: match.t, world: match.world };
    }
    selectedStreetEdgeIds = next;
    syncStreetNameDraft(next);
    editorError = '';
    scheduleRender();
  }

  function applyStreetName(): void {
    if (!selectedStreetEdgeIds.length) return;
    const name = streetNameDraft.trim();
    if (name.length > 120) {
      editorError = 'Der Straßenname darf höchstens 120 Zeichen lang sein.';
      return;
    }
    const hasChanges = editorGraph.edges.some((edge) => selectedStreetEdgeIds.includes(edge.id) && (edge.name ?? '') !== name);
    if (!hasChanges) return;
    recordEditorHistory();
    editorGraph = {
      ...editorGraph,
      edges: editorGraph.edges.map((edge) => selectedStreetEdgeIds.includes(edge.id)
        ? { ...edge, name: name || undefined }
        : edge),
    };
    streetNameDraft = name;
    editorDirty = true;
    editorError = '';
    networkReport = null;
    scheduleRender();
  }

  function splitSelectedStreetEdge(): void {
    if (!selectedStreetEdge || !selectedStreetEdgePoint || selectedStreetEdgePoint.t <= 0.02 || selectedStreetEdgePoint.t >= 0.98) return;
    recordEditorHistory();
    splitEditorEdge({ edge: selectedStreetEdge, ...selectedStreetEdgePoint });
    clearStreetEdgeSelection();
    editorDirty = true;
    editorError = '';
    networkReport = null;
    scheduleRender();
  }

  function editAt(pos: Point): void {
    if (editorMode === 'bma') {
      addBmaPoint(pos);
      return;
    }
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

    if (editorMode === 'street-name') {
      selectStreetEdge(pos);
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
    clearStreetEdgeSelection();
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
      clearStreetEdgeSelection();
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
        bma_zones: editorGraph.bma_zones ?? [],
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
      editorStreetPickStart = null;
      editorDragNodeId = editorMode === 'road' || editorMode === 'bridge' ? nearestEditorNode(pos, 12)?.id ?? null : null;
      if (editorMode === 'street-name' && nearestEditorEdge(pos, 14)) {
        editorStreetPickStart = pos;
        panning = false;
      } else {
        panning = !editorDragNodeId;
      }
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
      if (editorStreetPickStart) {
        const match = nearestEditorEdge(editorStreetPickStart, 14);
        editorSnapTarget = match ? { kind: 'edge', edgeId: match.edge.id, t: match.t, world: match.world } : null;
        editorCursorWorld = match?.world ?? null;
        scheduleRender();
        return;
      }
      if (editorDragNodeId) {
        if (!screenPointInMapContent(pos, view())) return;
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
      if (!screenPointInMapContent(pos, view())) {
        editorHoverNodeId = null;
        editorSnapTarget = null;
        editorCursorWorld = null;
        scheduleRender();
        return;
      }
      if (editorMode === 'bma') {
        editorHoverNodeId = null;
        editorSnapTarget = null;
        editorCursorWorld = canvasToWorld(pos, app.mapBounds, view());
      } else {
        editorSnapTarget = editorSnapAt(pos);
        editorCursorWorld = editorSnapTarget?.world ?? canvasToWorld(pos, app.mapBounds, view());
      }
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
      const insideMap = screenPointInMapContent(pos, view());
      if (editorStreetPickStart) {
        selectStreetEdge(editorStreetPickStart);
      } else {
        if (editorDragNodeId && dragged) {
          finishEditorNodeDrag(editorDragNodeId);
        } else if (!dragged && insideMap) {
          editAt(pos);
        }
      }
      editorDragNodeId = null;
      editorStreetPickStart = null;
      editorDragHistoryRecorded = false;
      if (!insideMap) {
        editorSnapTarget = null;
        editorCursorWorld = null;
      } else if (editorMode === 'bma') {
        editorSnapTarget = null;
        editorCursorWorld = canvasToWorld(pos, app.mapBounds, view());
      } else {
        editorSnapTarget = editorSnapAt(pos);
        editorCursorWorld = editorSnapTarget?.world ?? canvasToWorld(pos, app.mapBounds, view());
      }
      panning = false;
      dragged = false;
      scheduleRender();
      return;
    }
    if (placing && e.button === 0) {
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (!screenPointInMapContent(pos, view())) return;
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
      if (panning || editorDragNodeId || editorStreetPickStart) return;
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
    editorStreetPickStart = null;
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
    zoom = Math.max(MIN_ZOOM, Math.min(maximumZoom, zoom * factor));
    pan = { x: mouse.x - preX * zoom, y: mouse.y - preY * zoom };
    scheduleRender();
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (editorOpen) {
      if (editorMode === 'bma') undoBmaPoint();
      else if (editorMode === 'test') resetRouteTest();
      else finishEditorLine();
      scheduleRender();
      return;
    }
    const pos = clientToCanvas(e.clientX, e.clientY);
    if (!screenPointInMapContent(pos, view())) return;
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
    zoom = Math.max(MIN_ZOOM, Math.min(maximumZoom, zoom * factor));
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
    scheduleRender('markers');
    return next;
  }

  function resetFilters(): void {
    showVehicles = true;
    showEvents = true;
    hiddenStatuses = new Set();
    hiddenCategories = new Set();
    hiddenStations = new Set();
    scheduleRender('markers');
    emitFilterSettings();
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

  function drawLayers(which: ReadonlySet<MapLayer>): void {
    if (which.has('base')) renderBase();
    if (which.has('markers')) renderMarkers();
  }

  // Leert das Canvas und setzt die Transformation auf Pan und Zoom.
  function prepareContext(target: HTMLCanvasElement | undefined): CanvasRenderingContext2D | null {
    if (!target) return null;
    const ctx = target.getContext('2d', { alpha: true });
    if (!ctx) return null;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    return ctx;
  }

  // Basisebene: Kartenbild und Editor-Overlay. Wird nur bei Pan, Zoom,
  // Größenänderung, neuem Kartenbild oder Editor-Änderungen neu gezeichnet.
  function renderBase(): void {
    if (!canvas) return;
    const ctx = prepareContext(baseCanvas);
    if (!ctx) return;

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
      for (const zone of editorGraph.bma_zones ?? []) {
        if (zone.id === editingBmaZoneId) continue;
        if (zone.points.length < 3) continue;
        ctx.beginPath();
        zone.points.forEach((point, index) => {
          const canvasPoint = worldToCanvas(point, app.mapBounds, v);
          if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
          else ctx.lineTo(canvasPoint.x, canvasPoint.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(232, 82, 74, 0.16)';
        ctx.strokeStyle = '#e8524a';
        ctx.lineWidth = 2 / zoom;
        ctx.fill();
        ctx.stroke();
        const center = zone.points.reduce((sum, point) => ({ x: sum.x + point.x / zone.points.length, y: sum.y + point.y / zone.points.length }), { x: 0, y: 0 });
        const label = worldToCanvas(center, app.mapBounds, v);
        ctx.fillStyle = '#ffffff';
        ctx.font = `${12 / zoom}px Segoe UI`;
        ctx.textAlign = 'center';
        ctx.fillText(zone.name, label.x, label.y);
      }
      if (bmaDraftPoints.length) {
        ctx.beginPath();
        bmaDraftPoints.forEach((point, index) => {
          const canvasPoint = worldToCanvas(point, app.mapBounds, v);
          if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
          else ctx.lineTo(canvasPoint.x, canvasPoint.y);
        });
        if (editorCursorWorld) {
          const cursor = worldToCanvas(editorCursorWorld, app.mapBounds, v);
          ctx.lineTo(cursor.x, cursor.y);
        }
        ctx.strokeStyle = '#ff8580';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([5 / zoom, 4 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
      }
      ctx.setLineDash([]);
      if (editorMode === 'street-name') {
        ctx.save();
        for (const edge of editorGraph.edges) {
          if (!edge.name?.trim()) continue;
          const from = nodes.get(edge.from);
          const to = nodes.get(edge.to);
          if (!from || !to) continue;
          const a = worldToCanvas(from, app.mapBounds, v);
          const b = worldToCanvas(to, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          if (edge.kind === 'bridge') {
            ctx.lineWidth = 8 / zoom;
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(13, 15, 16, 0.92)';
            ctx.stroke();
          }
          ctx.lineWidth = 6 / zoom;
          ctx.setLineDash(edge.kind === 'bridge' ? [9 / zoom, 6 / zoom] : []);
          ctx.strokeStyle = cssVar('--good-text', '#62d9ad');
          ctx.stroke();
        }
        ctx.restore();
      }
      const hoveredEdgeId = editorSnapTarget?.kind === 'edge' ? editorSnapTarget.edgeId : null;
      if (hoveredEdgeId && !selectedStreetEdgeIds.includes(hoveredEdgeId)) {
        const edge = editorGraph.edges.find((candidate) => candidate.id === hoveredEdgeId);
        const from = edge ? nodes.get(edge.from) : null;
        const to = edge ? nodes.get(edge.to) : null;
        if (from && to) {
          const a = worldToCanvas(from, app.mapBounds, v);
          const b = worldToCanvas(to, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = (editorMode === 'street-name' ? 6 : 8) / zoom;
          ctx.setLineDash(editorMode === 'street-name' ? [4 / zoom, 4 / zoom] : []);
          ctx.strokeStyle = editorMode === 'unlink' ? 'rgba(232, 91, 98, 0.58)' : editorMode === 'street-name' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(242, 181, 93, 0.48)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (editorMode === 'street-name' && selectedStreetEdgeIds.length) {
        for (const edge of editorGraph.edges) {
          if (!selectedStreetEdgeIds.includes(edge.id)) continue;
          const from = nodes.get(edge.from);
          const to = nodes.get(edge.to);
          if (!from || !to) continue;
          const a = worldToCanvas(from, app.mapBounds, v);
          const b = worldToCanvas(to, app.mapBounds, v);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = 12 / zoom;
          ctx.setLineDash([]);
          ctx.strokeStyle = 'rgba(13, 15, 16, 0.92)';
          ctx.stroke();
          ctx.lineWidth = 7 / zoom;
          ctx.setLineDash(edge.kind === 'bridge' ? [9 / zoom, 6 / zoom] : []);
          ctx.strokeStyle = cssVar('--warn-text', '#ffc36b');
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
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

    ctx.restore();
  }

  // Markerebene: Einsätze und Fahrzeuge. Wird bei jedem Zustandsupdate neu
  // gezeichnet, ohne das Kartenbild anzufassen.
  function renderMarkers(): void {
    if (!canvas) return;
    const ctx = prepareContext(canvas);
    if (!ctx) return;
    drawMarkerLayer(ctx, {
      events: visibleEvents,
      vehicles: visibleVehicles,
      bounds: app.mapBounds,
      view: view(),
      highlightedEventId: app.highlightedEventId,
      highlightedVehicleId: app.highlightedVehicleId,
      eventMarkerKind: (ev) => (ev.created_by === 'frontend' ? 'control-room' : eventCategory(ev.name)),
      eventColor: (kind) => eventColor(kind as EventMarkerKind),
      eventIcon: (kind) => eventIconFor(kind as EventMarkerKind),
      vehicleIcon: iconFor,
      statusColor,
      statusText: statusDisplay,
      vehicleOutline: cssVar('--vehicle-outline', '#dfe7ff'),
    });
    ctx.restore();
  }
</script>

<svelte:window onkeydown={onEditorKeydown} />

<section class="panel map-panel">
  <div class="panel-header">
    <h2>{standaloneModId ? `Straßeneditor · ${standaloneModId}` : 'Karte'}</h2>
    <span class="spacer"></span>
    {#if standaloneModId}<span class="hint">Die Linien sind nur im Editor sichtbar</span>{/if}
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
    <canvas bind:this={baseCanvas}></canvas>
    <canvas bind:this={canvas}></canvas>
    <MapToolbar
      {editorAvailable}
      {editorOpen}
      {placing}
      {filtersOpen}
      standalone={Boolean(standaloneModId)}
      onZoomIn={() => zoomAtCenter(1.25)}
      onZoomOut={() => zoomAtCenter(0.8)}
      onReset={resetView}
      {onMapKeydown}
      onToggleEditor={() => editorOpen ? void closeEditor() : openEditor()}
      onTogglePlacing={() => (placing = !placing)}
      onToggleFilters={() => (filtersOpen = !filtersOpen)}
    />
    {#if editorOpen}
      <div class="route-editor" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} oncontextmenu={(e) => e.stopPropagation()} role="dialog" aria-label="Straßennetz bearbeiten" tabindex="-1">
        <div class="route-editor-head">
          <strong>Straßennetz</strong>
          <span>{namedStreetEdgeCount} von {editorGraph.edges.length} benannt</span>
          <button class="ghost" data-tooltip="Editor schließen" aria-label="Editor schließen" onclick={() => void closeEditor()}><FaIcon icon={X} size={14} /></button>
        </div>
        <div class="route-tools" role="toolbar" aria-label="Zeichenwerkzeuge">
          <button class:active={editorMode === 'road'} aria-pressed={editorMode === 'road'} onclick={() => setEditorMode('road')}><FaIcon icon={Route} size={14} /> Straße</button>
          <button class:active={editorMode === 'bridge'} aria-pressed={editorMode === 'bridge'} onclick={() => setEditorMode('bridge')}><FaIcon icon={Construction} size={14} /> Brücke</button>
          <button class:active={editorMode === 'unlink'} aria-pressed={editorMode === 'unlink'} onclick={() => setEditorMode('unlink')}><FaIcon icon={Unlink} size={14} /> Verbindung</button>
          <button class:active={editorMode === 'erase'} aria-pressed={editorMode === 'erase'} onclick={() => setEditorMode('erase')}><FaIcon icon={Eraser} size={14} /> Punkt</button>
          <button class:active={editorMode === 'street-name'} aria-pressed={editorMode === 'street-name'} onclick={() => setEditorMode('street-name')}>Straßenname</button>
          <button class:active={editorMode === 'bma'} aria-pressed={editorMode === 'bma'} onclick={() => setEditorMode('bma')}>BMA-Zone</button>
          {#if standaloneModId}<button class:active={editorMode === 'test'} aria-pressed={editorMode === 'test'} onclick={() => setEditorMode('test')}><FaIcon icon={Crosshair} size={14} /> Test</button>{/if}
        </div>
        {#if editorMode === 'street-name'}
          <p>Grün bedeutet bereits benannt. Die aktuelle Auswahl ist gelb mit dunkler Kontur.</p>
          <div class="street-name-fields">
            <label for="street-name">Straßenname · {selectedStreetEdgeCount} {selectedStreetEdgeCount === 1 ? 'Abschnitt' : 'Abschnitte'} ausgewählt</label>
            <input
              id="street-name"
              type="text"
              maxlength="120"
              disabled={!selectedStreetEdgeCount}
              bind:value={streetNameDraft}
              placeholder={selectedStreetEdgeCount ? 'Straßenname eingeben' : 'Zuerst Abschnitte anklicken'}
              onkeydown={(event) => { if (event.key === 'Enter') applyStreetName(); }}
            />
            <div class="street-name-actions">
              <button disabled={!selectedStreetEdgeCount} onclick={applyStreetName}>Auf Auswahl anwenden</button>
              <button class="ghost" disabled={!selectedStreetEdgeCount} onclick={() => { clearStreetEdgeSelection(); scheduleRender(); }}>Auswahl aufheben</button>
              <button class="ghost" disabled={!selectedStreetEdgePoint || selectedStreetEdgePoint.t <= 0.02 || selectedStreetEdgePoint.t >= 0.98} onclick={splitSelectedStreetEdge}>Letzten Abschnitt teilen</button>
            </div>
          </div>
        {:else if editorMode === 'bma'}
          <p>{editingBmaZoneId ? 'Bezeichnung oder Fläche ändern und erneut speichern.' : 'Bezeichnung eingeben und die Zone mit mindestens drei Punkten auf der Karte umranden.'} Rechtsklick nimmt den letzten Punkt zurück.</p>
          <div class="bma-editor-fields">
            <input type="text" maxlength="120" bind:value={bmaDraftName} placeholder="Bezeichnung, z. B. Rathaus" />
            <span>{bmaDraftPoints.length} Punkte</span>
            <button disabled={bmaDraftPoints.length < 3 || !bmaDraftName.trim()} onclick={saveBmaZone}>{editingBmaZoneId ? 'Änderungen speichern' : 'Zone speichern'}</button>
            <button class="ghost" disabled={!bmaDraftPoints.length} onclick={() => { bmaDraftPoints = []; scheduleRender(); }}>Neu zeichnen</button>
            {#if editingBmaZoneId}<button class="ghost" onclick={cancelBmaEdit}>Abbrechen</button>{/if}
          </div>
          {#if editorGraph.bma_zones?.length}
            <div class="bma-zone-list">
              {#each editorGraph.bma_zones as zone (zone.id)}
                <span class="bma-zone-name" class:editing={zone.id === editingBmaZoneId}>{zone.name}</span>
                <span class="bma-zone-actions">
                  <button class="ghost" disabled={zone.id === editingBmaZoneId} onclick={() => editBmaZone(zone)}>Bearbeiten</button>
                  <button class="ghost" aria-label={`${zone.name} löschen`} onclick={() => void removeBmaZone(zone.id, zone.name)}><FaIcon icon={Trash2} size={13} /></button>
                </span>
              {/each}
            </div>
          {/if}
        {:else if editorMode === 'test'}
          <p>Klicke zuerst den Start und danach das Ziel. Weiß gestrichelt ist der Anschluss zur nächsten Straße, Orange ist die berechnete Route.</p>
          {#if routeTestPreview}
            <div class="route-test-result" class:fallback={routeTestPreview.fallback}>
              <div>
                <strong>{formatDistance(routeTestPreview)}</strong>
                <span>Anschluss Start {Math.round(routeTestPreview.startSnap.connectorMeters)} m · Ziel {Math.round(routeTestPreview.endSnap.connectorMeters)} m</span>
              </div>
              <button class="ghost" aria-label="Routentest zurücksetzen" data-tooltip="Routentest zurücksetzen" onclick={resetRouteTest}><FaIcon icon={X} size={14} /></button>
            </div>
          {:else if routeTestStart}
            <div class="route-test-result">
              <div>
                <strong>Start gesetzt</strong>
                <span>{routeTestStartSnap ? `Nächster Straßenpunkt: ${Math.round(routeTestStartSnap.connectorMeters)} m` : 'Das Straßennetz ist leer.'}</span>
              </div>
              <button class="ghost" aria-label="Routentest zurücksetzen" data-tooltip="Routentest zurücksetzen" onclick={resetRouteTest}><FaIcon icon={X} size={14} /></button>
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
              <label class="grid-toggle"><input type="checkbox" bind:checked={showEditorGrid} onchange={() => scheduleRender('base')} /> <FaIcon icon={Grid3X3} size={13} /> anzeigen</label>
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
                {#if issue.point}<FaIcon icon={Crosshair} size={12} />{/if}
              </button>
            {/each}
            {#if networkReport.issues.length > 8}<span class="network-more">+{networkReport.issues.length - 8} weitere Befunde</span>{/if}
          </div>
        {/if}
        <div class="route-actions">
          <input class="routing-file-input" bind:this={importInput} type="file" accept=".json,application/json" onchange={(event) => void importEditorFile(event)} />
          <button disabled={!editorHistory.length} data-tooltip="Rückgängig" aria-label="Letzte Änderung rückgängig" onclick={undoEditor}><FaIcon icon={Undo2} size={14} /></button>
          <button disabled={!editorActiveNodeId} onclick={finishEditorLine}><FaIcon icon={Check} size={14} /> Linie beenden</button>
          <button class="danger-text" disabled={!editorGraph.edges.length} data-tooltip="Alles löschen" aria-label="Gesamtes Straßennetz löschen" onclick={() => void clearEditor()}><FaIcon icon={Trash2} size={14} /></button>
          <button onclick={runNetworkCheck}><FaIcon icon={ShieldCheck} size={14} /> Netz prüfen</button>
          <button onclick={() => importInput?.click()}><FaIcon icon={Upload} size={14} /> JSON laden</button>
          <button class="save-route" disabled={!editorDirty || editorSaving || (!standaloneModId && !canWrite())} onclick={() => void saveEditor()}><FaIcon icon={Save} size={14} /> {editorSaving ? 'Speichert …' : 'Speichern'}</button>
        </div>
      </div>
    {/if}
    {#if filtersOpen}
      <MapFilters
        {showVehicles}
        {showEvents}
        {hiddenStatuses}
        {hiddenCategories}
        {hiddenStations}
        {stations}
        categoryColor={eventColor}
        onShowVehiclesChange={(checked) => { showVehicles = checked; scheduleRender('markers'); emitFilterSettings(); }}
        onShowEventsChange={(checked) => { showEvents = checked; scheduleRender('markers'); emitFilterSettings(); }}
        onToggleStatus={(status) => { hiddenStatuses = toggleSet(hiddenStatuses, status); emitFilterSettings(); }}
        onToggleCategory={(category) => { hiddenCategories = toggleSet(hiddenCategories, category); emitFilterSettings(); }}
        onToggleStation={(stationName) => { hiddenStations = toggleSet(hiddenStations, stationName); emitFilterSettings(); }}
        onReset={resetFilters}
        onClose={() => (filtersOpen = false)}
      />
    {/if}
    {#if tooltipEvent}
      <div class="map-tooltip" style="left: {eventTooltipPosition.x + 14}px; top: {eventTooltipPosition.y + 14}px;">
        <span class="tt-copy">
          <span class="tt-name">{tooltipEvent.name || 'Einsatz'}</span>
          {#if roadLocationLabel(tooltipEvent, app.routing)}<span class="tt-location">{roadLocationLabel(tooltipEvent, app.routing)}</span>{/if}
        </span>
      </div>
    {:else if tooltipVehicle}
      <div class="map-tooltip" style="left: {vehicleTooltipPosition.x + 14}px; top: {vehicleTooltipPosition.y + 14}px;">
        <span class="tt-copy">
          <span class="tt-name">{tooltipVehicle.name || tooltipVehicle.type || tooltipVehicle.game_vehicle_id}</span>
        </span>
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
    <details class="status-help" use:dismissibleDetails>
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

  .route-editor { --text: #e9eaec; --text-dim: #aeb1b7; --bg-raised: #24262a; --border: #34373c; --border-strong: #565a61; --accent-soft: rgba(255, 255, 255, 0.08); --accent-outline: #b8d0ff; --danger-text: #ff8580; --warn-text: #ffc36b; position: absolute; top: 10px; left: 10px; z-index: 7; width: min(430px, calc(100% - 74px)); max-height: calc(100% - 20px); overflow: auto; border: 1px solid var(--border-strong); background: rgba(21, 22, 25, 0.98); color: var(--text); box-shadow: var(--shadow); cursor: default; }
  .route-editor-head { min-height: 38px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; border-bottom: 1px solid var(--border); }
  .route-editor-head strong { font-size: 12px; }
  .route-editor-head span { flex: 1; color: var(--text-dim); font-size: 11px; }
  .route-tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 8px; border-bottom: 1px solid var(--border); }
  .route-tools button { justify-content: center; font-size: 11px; }
  .route-tools button.active { border-color: #b98443; background: rgba(185, 132, 67, 0.16); color: #f3c98f; }
  .route-editor p { margin: 0; padding: 8px 10px; border-bottom: 1px solid var(--border); color: var(--text-dim); font-size: 11px; line-height: 1.45; }
  .street-name-fields { display: grid; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .street-name-fields label { color: var(--text); font-size: 11px; }
  .street-name-fields input { width: 100%; }
  .street-name-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .street-name-actions button:last-child { margin-left: auto; }
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

  .tt-copy { display: flex; flex-direction: column; gap: 1px; }
  .tt-location { color: var(--text-dim); font-size: 10px; font-weight: 500; }

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
  .bma-editor-fields { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
  .bma-editor-fields input { grid-column: 1 / -1; }
  .bma-editor-fields > span { color: var(--text-dim); font-size: 11px; }
  .bma-zone-list { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; padding-top: 8px; border-top: 1px solid var(--border); }
  .bma-zone-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .bma-zone-name.editing { color: var(--accent-outline); font-weight: 650; }
  .bma-zone-actions { display: inline-flex; gap: 4px; }
  .bma-zone-actions button { padding: 3px 6px; font-size: 11px; }
  .status-help summary:hover, .status-help summary:focus-visible { color: var(--text); }
  .status-popover { position: absolute; right: 0; bottom: calc(100% + 8px); width: 210px; padding: 8px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow); display: grid; gap: 5px; z-index: 8; }
  .status-popover > span { display: flex; align-items: center; gap: 8px; color: var(--text); }

  @media (max-width: 620px) {
    .hint { display: none; }
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
