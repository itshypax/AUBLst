// Arbeitsansichten: Panels liegen als Rechtecke in einem 24x16-Raster.
// Alte Ansichten mit vier festen Bereichen werden beim Laden umgerechnet.

export const PANEL_IDS = [
  'map',
  'vehicles',
  'events',
  'current_event',
  'logs',
  'speech_requests',
  'hospitals',
  'bmas',
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const PANEL_LABELS: Record<PanelId, string> = {
  map: 'Karte',
  vehicles: 'Fahrzeuge',
  events: 'Einsätze',
  current_event: 'Aktueller Einsatz',
  logs: 'FMS-LOG',
  speech_requests: 'Sprechwünsche',
  hospitals: 'Krankenhäuser',
  bmas: 'BMAs',
};

export const GRID_COLUMNS = 24;
export const GRID_ROWS = 16;
export const MIN_PANEL_WIDTH = 3;
export const MIN_PANEL_HEIGHT = 3;

// Diese Panels dürfen mehrfach in einer Ansicht liegen, etwa zwei
// Fahrzeuglisten mit festem Tab. Das Einsatzfenster bleibt einmalig, weil die
// Fenster-Synchronisation genau ein Einsatzfenster je Fenster erwartet.
export const MULTI_INSTANCE_PANELS: ReadonlySet<PanelId> = new Set<PanelId>(['map', 'vehicles', 'events', 'logs', 'hospitals']);

export type EventsFilter = 'new' | 'current';
export const EVENTS_FILTERS: readonly EventsFilter[] = ['new', 'current'];
const MAP_CATEGORIES = ['fire', 'hazard', 'water', 'thl', 'medical', 'other'];

export interface MapFilterSettings {
  showVehicles?: boolean;
  showEvents?: boolean;
  hiddenStatuses?: number[];
  hiddenCategories?: string[];
  hiddenStations?: string[];
}

// Einstellungen je Fensterinstanz. Sie wandern mit dem Layout in Speicher,
// Datei und Server-Bibliothek.
export interface PanelSettings {
  vehiclesTab?: 'fire' | 'rescue' | 'all';
  eventsFilters?: EventsFilter[];
  mapFilters?: MapFilterSettings;
}

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorkspacePanel extends GridRect {
  key: string;
  type: PanelId;
  settings?: PanelSettings;
}

export interface WorkspaceLayout {
  id: string;
  name: string;
  panels: WorkspacePanel[];
  // Teilcode der Server-Bibliothek, wenn das Layout dort liegt
  code?: string;
}

// Altes Modell (bis September 2026): vier feste Bereiche.
export const AREA_IDS = ['leftTop', 'leftBottom', 'rightTop', 'rightBottom'] as const;
export type AreaId = (typeof AREA_IDS)[number];
export type AreaDirection = 'row' | 'column' | 'mosaic';
export interface LegacyWorkspaceLayout {
  id: string;
  name: string;
  areas: Record<AreaId, PanelId[]>;
  directions: Record<AreaId, AreaDirection>;
  ratios: { col: number; left: number; right: number };
  panelRatios: Record<AreaId, number[]>;
}

export const WORKSPACE_STORAGE_KEY = 'leitstelleWorkspaces:v2';
export const LEGACY_STORAGE_KEY = 'leitstelleWorkspaces:v1';
// Spiegel im localStorage: ein neues Fenster startet mit dem zuletzt
// gespeicherten Satz statt mit den Vorlagen.
export const LOCAL_MIRROR_KEY = 'leitstelleWorkspaces:v2:last';
const WORKSPACE_TRANSFER_PARAM = 'workspace_layout';
const MAX_WORKSPACES = 20;

function panel(key: PanelId, x: number, y: number, w: number, h: number): WorkspacePanel {
  return { key, type: key, x, y, w, h };
}

export const DEFAULT_WORKSPACES: WorkspaceLayout[] = [
  {
    id: 'standard',
    name: 'Standard',
    panels: [
      panel('events', 0, 0, 6, 6),
      panel('bmas', 0, 6, 3, 4),
      panel('speech_requests', 3, 6, 3, 4),
      panel('current_event', 6, 0, 8, 10),
      panel('hospitals', 0, 10, 7, 6),
      panel('logs', 7, 10, 7, 6),
      panel('vehicles', 14, 0, 10, 9),
      panel('map', 14, 9, 10, 7),
    ],
  },
  {
    id: 'einsatzmonitor',
    name: 'Einsatzmonitor',
    panels: [panel('map', 0, 0, 16, 16), panel('events', 16, 0, 8, 16)],
  },
  {
    id: 'funkmonitor',
    name: 'Fahrzeuge und Funk',
    panels: [panel('vehicles', 0, 0, 15, 16), panel('logs', 15, 0, 9, 11), panel('hospitals', 15, 11, 9, 5)],
  },
  {
    id: 'leitstelle',
    name: 'Leitstelle kompakt',
    panels: [
      panel('events', 0, 0, 9, 9),
      panel('bmas', 0, 9, 4, 7),
      panel('speech_requests', 4, 9, 5, 7),
      panel('current_event', 9, 0, 15, 16),
    ],
  },
];

export function cloneWorkspace(layout: WorkspaceLayout): WorkspaceLayout {
  const copy: WorkspaceLayout = {
    id: layout.id,
    name: layout.name,
    panels: layout.panels.map((item) => ({
      ...item,
      ...(item.settings ? { settings: JSON.parse(JSON.stringify(item.settings)) as PanelSettings } : {}),
    })),
  };
  if (layout.code) copy.code = layout.code;
  return copy;
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function rectInsideGrid(rect: GridRect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.w >= MIN_PANEL_WIDTH && rect.h >= MIN_PANEL_HEIGHT
    && rect.x + rect.w <= GRID_COLUMNS && rect.y + rect.h <= GRID_ROWS;
}

// Liegt das Rechteck im Raster und frei von anderen Panels? ignoreKey lässt
// das eigene Panel beim Verschieben außen vor.
export function rectFits(layout: WorkspaceLayout, rect: GridRect, ignoreKey?: string): boolean {
  if (!rectInsideGrid(rect)) return false;
  return !layout.panels.some((item) => item.key !== ignoreKey && rectsOverlap(item, rect));
}

export function findFreeSpot(layout: WorkspaceLayout, w: number, h: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= GRID_ROWS; y += 1) {
    for (let x = 0; x + w <= GRID_COLUMNS; x += 1) {
      if (rectFits(layout, { x, y, w, h })) return { x, y };
    }
  }
  return null;
}

export function nextPanelKey(layout: WorkspaceLayout, type: PanelId): string {
  const keys = new Set(layout.panels.map((item) => item.key));
  if (!keys.has(type)) return type;
  let index = 2;
  while (keys.has(`${type}-${index}`)) index += 1;
  return `${type}-${index}`;
}

export function panelTypes(layout: WorkspaceLayout): PanelId[] {
  return [...new Set(stackedPanels(layout).map((item) => item.type))];
}

// Reihenfolge für schmale Bildschirme: Zeile für Zeile, links nach rechts.
export function stackedPanels(layout: WorkspaceLayout): WorkspacePanel[] {
  return [...layout.panels].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function addPanel(layout: WorkspaceLayout, type: PanelId): WorkspaceLayout | null {
  if (!MULTI_INSTANCE_PANELS.has(type) && layout.panels.some((item) => item.type === type)) return null;
  for (const [w, h] of [[6, 5], [4, 4], [MIN_PANEL_WIDTH, MIN_PANEL_HEIGHT]]) {
    const spot = findFreeSpot(layout, w, h);
    if (!spot) continue;
    return { ...cloneWorkspace(layout), panels: [...layout.panels, { key: nextPanelKey(layout, type), type, ...spot, w, h }] };
  }
  return null;
}

export function removePanel(layout: WorkspaceLayout, key: string): WorkspaceLayout {
  return { ...cloneWorkspace(layout), panels: layout.panels.filter((item) => item.key !== key) };
}

export function updatePanelSettings(layout: WorkspaceLayout, key: string, settings: PanelSettings): WorkspaceLayout {
  return {
    ...cloneWorkspace(layout),
    panels: layout.panels.map((item) => (item.key === key ? { ...item, settings: { ...item.settings, ...settings } } : item)),
  };
}

// Verschieben auf freie Fläche. Trifft das Rechteck exakt ein anderes Panel
// gleicher Größe, tauschen beide die Plätze. Sonst null.
export function movePanel(layout: WorkspaceLayout, key: string, x: number, y: number): WorkspaceLayout | null {
  const moving = layout.panels.find((item) => item.key === key);
  if (!moving) return null;
  const target: GridRect = { x, y, w: moving.w, h: moving.h };
  if (!rectInsideGrid(target)) return null;
  if (rectFits(layout, target, key)) {
    return { ...cloneWorkspace(layout), panels: layout.panels.map((item) => (item.key === key ? { ...item, x, y } : item)) };
  }
  const partner = layout.panels.find((item) => item.key !== key && item.x === x && item.y === y && item.w === moving.w && item.h === moving.h);
  if (!partner) return null;
  return {
    ...cloneWorkspace(layout),
    panels: layout.panels.map((item) => {
      if (item.key === key) return { ...item, x, y };
      if (item.key === partner.key) return { ...item, x: moving.x, y: moving.y };
      return item;
    }),
  };
}

export function resizePanel(layout: WorkspaceLayout, key: string, w: number, h: number): WorkspaceLayout | null {
  const target = layout.panels.find((item) => item.key === key);
  if (!target) return null;
  return resizePanelRect(layout, key, {
    x: target.x,
    y: target.y,
    w: Math.max(MIN_PANEL_WIDTH, Math.round(w)),
    h: Math.max(MIN_PANEL_HEIGHT, Math.round(h)),
  });
}

// Setzt Position und Größe in einem Schritt, etwa beim Ziehen an der
// linken oder oberen Kante. Unter der Mindestgröße, außerhalb des Rasters
// oder auf einem Nachbarn gibt es null.
export function resizePanelRect(layout: WorkspaceLayout, key: string, rect: GridRect): WorkspaceLayout | null {
  if (!layout.panels.some((item) => item.key === key)) return null;
  const next: GridRect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  if (!rectFits(layout, next, key)) return null;
  return { ...cloneWorkspace(layout), panels: layout.panels.map((item) => (item.key === key ? { ...item, ...next } : item)) };
}

export function resetWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const preset = DEFAULT_WORKSPACES.find((workspace) => workspace.id === layout.id) ?? DEFAULT_WORKSPACES[0];
  const reset = { ...cloneWorkspace(preset), id: layout.id, name: layout.name };
  if (layout.code) reset.code = layout.code;
  return reset;
}

// Teilt eine Strecke nach Anteilen in ganze Rasterzellen auf; der Rest geht
// an das letzte Stück. Reicht die Strecke nicht für Mindestgrößen, wird
// gleichmäßig geteilt.
function splitByRatios(total: number, ratios: number[], minimum: number): number[] {
  if (!ratios.length) return [];
  const sum = ratios.reduce((acc, ratio) => acc + ratio, 0) || 1;
  let used = 0;
  const parts = ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return total - used;
    const part = Math.max(1, Math.round((ratio / sum) * total));
    used += part;
    return part;
  });
  if (parts.every((part) => part >= minimum)) return parts;
  const even = Math.floor(total / ratios.length);
  return ratios.map((_, index) => (index === ratios.length - 1 ? total - even * (ratios.length - 1) : even));
}

function layoutLegacyArea(
  panels: PanelId[],
  direction: AreaDirection,
  ratios: number[],
  rect: GridRect,
  taken: Set<string>,
): WorkspacePanel[] {
  if (!panels.length || rect.w <= 0 || rect.h <= 0) return [];
  const result: WorkspacePanel[] = [];
  const keyFor = (type: PanelId): string => {
    let key: string = type;
    let index = 2;
    while (taken.has(key)) key = `${type}-${index++}`;
    taken.add(key);
    return key;
  };
  const weights = ratios.length === panels.length ? ratios : panels.map(() => 1);
  if (direction === 'mosaic' && panels.length === 4) {
    const [c1, c2, c3] = splitByRatios(rect.w, [0.22, 0.22, 0.56], 1);
    const [r1, r2] = splitByRatios(rect.h, [0.58, 0.42], 1);
    const cells: GridRect[] = [
      { x: rect.x, y: rect.y, w: c1 + c2, h: r1 },
      { x: rect.x, y: rect.y + r1, w: c1, h: r2 },
      { x: rect.x + c1, y: rect.y + r1, w: c2, h: r2 },
      { x: rect.x + c1 + c2, y: rect.y, w: c3, h: rect.h },
    ];
    panels.forEach((type, index) => result.push({ key: keyFor(type), type, ...cells[index] }));
    return result;
  }
  if (direction === 'column') {
    const heights = splitByRatios(rect.h, weights, MIN_PANEL_HEIGHT);
    let y = rect.y;
    panels.forEach((type, index) => {
      result.push({ key: keyFor(type), type, x: rect.x, y, w: rect.w, h: heights[index] });
      y += heights[index];
    });
    return result;
  }
  const widths = splitByRatios(rect.w, weights, MIN_PANEL_WIDTH);
  let x = rect.x;
  panels.forEach((type, index) => {
    result.push({ key: keyFor(type), type, x, y: rect.y, w: widths[index], h: rect.h });
    x += widths[index];
  });
  return result;
}

function ratio(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.85, Math.max(0.15, number)) : fallback;
}

export function migrateLegacyWorkspace(legacy: Partial<LegacyWorkspaceLayout>): WorkspaceLayout {
  const areas = Object.fromEntries(
    AREA_IDS.map((area) => [area, (Array.isArray(legacy.areas?.[area]) ? legacy.areas![area] : []).filter((item): item is PanelId => PANEL_IDS.includes(item as PanelId))]),
  ) as Record<AreaId, PanelId[]>;
  const hasLeft = areas.leftTop.length > 0 || areas.leftBottom.length > 0;
  const hasRight = areas.rightTop.length > 0 || areas.rightBottom.length > 0;
  const leftWidth = hasLeft && hasRight ? Math.round(ratio(legacy.ratios?.col, 0.58) * GRID_COLUMNS) : hasLeft ? GRID_COLUMNS : 0;
  const rightWidth = GRID_COLUMNS - leftWidth;
  const leftTopHeight = areas.leftTop.length && areas.leftBottom.length
    ? Math.round(ratio(legacy.ratios?.left, 0.62) * GRID_ROWS)
    : areas.leftTop.length ? GRID_ROWS : 0;
  const rightTopHeight = areas.rightTop.length && areas.rightBottom.length
    ? Math.round(ratio(legacy.ratios?.right, 0.55) * GRID_ROWS)
    : areas.rightTop.length ? GRID_ROWS : 0;
  const rects: Record<AreaId, GridRect> = {
    leftTop: { x: 0, y: 0, w: leftWidth, h: leftTopHeight },
    leftBottom: { x: 0, y: leftTopHeight, w: leftWidth, h: GRID_ROWS - leftTopHeight },
    rightTop: { x: leftWidth, y: 0, w: rightWidth, h: rightTopHeight },
    rightBottom: { x: leftWidth, y: rightTopHeight, w: rightWidth, h: GRID_ROWS - rightTopHeight },
  };
  const taken = new Set<string>();
  const panels = AREA_IDS.flatMap((area) =>
    layoutLegacyArea(areas[area], legacy.directions?.[area] ?? 'row', legacy.panelRatios?.[area] ?? [], rects[area], taken),
  );
  return normalizeWorkspace({ id: legacy.id, name: legacy.name, panels }, typeof legacy.id === 'string' ? legacy.id : 'standard');
}

function isLegacy(value: unknown): value is Partial<LegacyWorkspaceLayout> {
  return Boolean(value && typeof value === 'object' && 'areas' in (value as object) && !('panels' in (value as object)));
}

function normalizeMapFilters(value: unknown): MapFilterSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as MapFilterSettings;
  const filters: MapFilterSettings = {};
  if (typeof raw.showVehicles === 'boolean') filters.showVehicles = raw.showVehicles;
  if (typeof raw.showEvents === 'boolean') filters.showEvents = raw.showEvents;
  if (Array.isArray(raw.hiddenStatuses)) {
    filters.hiddenStatuses = [...new Set(raw.hiddenStatuses.map(Number).filter((status) => Number.isInteger(status) && status >= 0 && status <= 9))];
  }
  if (Array.isArray(raw.hiddenCategories)) {
    filters.hiddenCategories = [...new Set(raw.hiddenCategories.filter((category): category is string => typeof category === 'string' && MAP_CATEGORIES.includes(category)))];
  }
  if (Array.isArray(raw.hiddenStations)) {
    filters.hiddenStations = [...new Set(raw.hiddenStations.filter((station): station is string => typeof station === 'string' && station.length > 0 && station.length <= 20))].slice(0, 50);
  }
  return Object.keys(filters).length ? filters : undefined;
}

function normalizeSettings(type: PanelId, value: unknown): PanelSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as PanelSettings;
  const settings: PanelSettings = {};
  if (type === 'vehicles' && (raw.vehiclesTab === 'fire' || raw.vehiclesTab === 'rescue' || raw.vehiclesTab === 'all')) settings.vehiclesTab = raw.vehiclesTab;
  if (type === 'events' && Array.isArray(raw.eventsFilters)) {
    settings.eventsFilters = EVENTS_FILTERS.filter((filter) => raw.eventsFilters!.includes(filter));
  }
  if (type === 'map') {
    const mapFilters = normalizeMapFilters(raw.mapFilters);
    if (mapFilters) settings.mapFilters = mapFilters;
  }
  return Object.keys(settings).length ? settings : undefined;
}

// Prüft ein geladenes Layout Panel für Panel: unbekannte Typen, Rechtecke
// außerhalb des Rasters und Überlappungen fliegen raus, doppelte Schlüssel
// werden neu vergeben.
export function normalizeWorkspace(value: Partial<WorkspaceLayout>, fallbackId: string): WorkspaceLayout {
  const result: WorkspaceLayout = {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : fallbackId,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Unbenannte Ansicht',
    panels: [],
  };
  if (typeof value.code === 'string' && /^[A-Z0-9]{4,12}$/.test(value.code.trim().toUpperCase())) {
    result.code = value.code.trim().toUpperCase();
  }
  const keys = new Set<string>();
  for (const raw of Array.isArray(value.panels) ? value.panels : []) {
    if (!raw || typeof raw !== 'object') continue;
    const type = (raw as WorkspacePanel).type;
    if (!PANEL_IDS.includes(type)) continue;
    const rect: GridRect = {
      x: Math.round(Number((raw as WorkspacePanel).x)),
      y: Math.round(Number((raw as WorkspacePanel).y)),
      w: Math.round(Number((raw as WorkspacePanel).w)),
      h: Math.round(Number((raw as WorkspacePanel).h)),
    };
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) continue;
    if (!rectFits(result, rect)) continue;
    if (!MULTI_INSTANCE_PANELS.has(type) && result.panels.some((item) => item.type === type)) continue;
    let key = typeof (raw as WorkspacePanel).key === 'string' && (raw as WorkspacePanel).key.trim() ? (raw as WorkspacePanel).key.trim() : type;
    if (keys.has(key)) key = nextPanelKey(result, type);
    keys.add(key);
    const settings = normalizeSettings(type, (raw as WorkspacePanel).settings);
    result.panels.push({ key, type, ...rect, ...(settings ? { settings } : {}) });
  }
  return result;
}

function parseStoredList(raw: string | null): WorkspaceLayout[] | null {
  try {
    const parsed = JSON.parse(raw ?? 'null');
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.slice(0, MAX_WORKSPACES).map((item, index) => {
      const fallbackId = DEFAULT_WORKSPACES[index]?.id ?? `ansicht-${index + 1}`;
      return isLegacy(item) ? migrateLegacyWorkspace(item) : normalizeWorkspace(item ?? {}, fallbackId);
    });
  } catch {
    return null;
  }
}

export function loadWorkspaces(): WorkspaceLayout[] {
  let initial =
    parseStoredList(sessionStorage.getItem(WORKSPACE_STORAGE_KEY))
    ?? parseStoredList(sessionStorage.getItem(LEGACY_STORAGE_KEY))
    ?? parseStoredList(localStorage.getItem(LOCAL_MIRROR_KEY))
    ?? parseStoredList(localStorage.getItem(LEGACY_STORAGE_KEY))
    ?? DEFAULT_WORKSPACES.map(cloneWorkspace);

  const transferred = workspaceFromUrl();
  if (transferred) {
    const workspace = isLegacy(transferred) ? migrateLegacyWorkspace(transferred) : normalizeWorkspace(transferred, 'standard');
    const index = initial.findIndex((item) => item.id === workspace.id);
    initial = index === -1 ? [...initial, workspace] : initial.map((item) => (item.id === workspace.id ? workspace : item));
  }

  saveWorkspaces(initial);
  return initial;
}

export function saveWorkspaces(workspaces: WorkspaceLayout[]): void {
  const serialized = JSON.stringify(workspaces);
  sessionStorage.setItem(WORKSPACE_STORAGE_KEY, serialized);
  try {
    localStorage.setItem(LOCAL_MIRROR_KEY, serialized);
  } catch {
    // Der Spiegel ist Komfort; ohne localStorage bleibt das Fenster trotzdem bedienbar.
  }
}

export function workspaceIdFromUrl(workspaces: WorkspaceLayout[]): string {
  const requested = new URLSearchParams(location.search).get('workspace');
  return workspaces.some((workspace) => workspace.id === requested) ? requested! : workspaces[0].id;
}

export function setWorkspaceInUrl(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set('workspace', id);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function workspaceFromUrl(): Partial<WorkspaceLayout> | Partial<LegacyWorkspaceLayout> | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(WORKSPACE_TRANSFER_PARAM);
  if (!value) return null;
  url.searchParams.delete(WORKSPACE_TRANSFER_PARAM);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function workspaceUrl(workspace: WorkspaceLayout): string {
  const url = new URL(location.href);
  url.searchParams.set('workspace', workspace.id);
  url.searchParams.set(WORKSPACE_TRANSFER_PARAM, JSON.stringify(workspace));
  return url.toString();
}

export function nextWorkspaceId(): string {
  return `ansicht-${Date.now().toString(36)}`;
}

// ?layout=CODE aus der Adresszeile: einmal lesen, dann entfernen, damit ein
// Reload das Layout nicht erneut vom Server holt.
export function sharedLayoutCodeFromUrl(): string | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get('layout');
  if (raw === null) return null;
  url.searchParams.delete('layout');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}
