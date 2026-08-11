export const PANEL_IDS = ['map', 'vehicles', 'events', 'current_event', 'logs', 'hospitals'] as const;
export const AREA_IDS = ['leftTop', 'leftBottom', 'rightTop', 'rightBottom'] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type AreaId = (typeof AREA_IDS)[number];
export type AreaDirection = 'row' | 'column';

export interface WorkspaceLayout {
  id: string;
  name: string;
  areas: Record<AreaId, PanelId[]>;
  directions: Record<AreaId, AreaDirection>;
  ratios: { col: number; left: number; right: number };
  panelRatios: Record<AreaId, number[]>;
}

export const WORKSPACE_STORAGE_KEY = 'leitstelleWorkspaces:v1';

const DEFAULT_RATIOS = { col: 0.58, left: 0.62, right: 0.55 };

export const DEFAULT_WORKSPACES: WorkspaceLayout[] = [
  {
    id: 'standard',
    name: 'Standard',
    areas: { leftTop: ['events', 'current_event'], leftBottom: ['logs', 'hospitals'], rightTop: ['vehicles'], rightBottom: ['map'] },
    directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    ratios: DEFAULT_RATIOS,
    panelRatios: { leftTop: [0.34, 0.66], leftBottom: [0.5, 0.5], rightTop: [1], rightBottom: [1] },
  },
  {
    id: 'einsatzmonitor',
    name: 'Einsatzmonitor',
    areas: { leftTop: ['map'], leftBottom: [], rightTop: ['events'], rightBottom: [] },
    directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    ratios: { col: 0.68, left: 0.5, right: 0.5 },
    panelRatios: { leftTop: [1], leftBottom: [], rightTop: [1], rightBottom: [] },
  },
  {
    id: 'funkmonitor',
    name: 'Fahrzeuge und Funk',
    areas: { leftTop: ['vehicles'], leftBottom: [], rightTop: ['logs'], rightBottom: ['hospitals'] },
    directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    ratios: { col: 0.62, left: 0.5, right: 0.68 },
    panelRatios: { leftTop: [1], leftBottom: [], rightTop: [1], rightBottom: [1] },
  },
];

function clamp(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.85, Math.max(0.15, number)) : fallback;
}

function normalizePanelRatios(value: unknown, count: number, fallback: number[] = []): number[] {
  if (!count) return [];
  const candidates = Array.isArray(value) && value.length === count
    ? value.map(Number)
    : fallback.length === count ? fallback : Array(count).fill(1);
  const valid = candidates.every((ratio) => Number.isFinite(ratio) && ratio > 0);
  const ratios = valid ? candidates : Array(count).fill(1);
  const sum = ratios.reduce((total, ratio) => total + ratio, 0);
  return ratios.map((ratio) => ratio / sum);
}

export function cloneWorkspace(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    ...layout,
    areas: Object.fromEntries(AREA_IDS.map((area) => [area, [...layout.areas[area]]])) as Record<AreaId, PanelId[]>,
    directions: { ...layout.directions },
    ratios: { ...layout.ratios },
    panelRatios: Object.fromEntries(AREA_IDS.map((area) => [area, [...layout.panelRatios[area]]])) as Record<AreaId, number[]>,
  };
}

function normalizeWorkspace(value: Partial<WorkspaceLayout>, fallback: WorkspaceLayout): WorkspaceLayout {
  const seen = new Set<PanelId>();
  const legacyStandard = value.id === 'standard'
    && !AREA_IDS.some((area) => value.areas?.[area]?.includes('current_event'));
  const areas = Object.fromEntries(AREA_IDS.map((area) => {
    const candidates = legacyStandard
      ? fallback.areas[area]
      : Array.isArray(value.areas?.[area]) ? value.areas[area] : fallback.areas[area];
    const panels = candidates.filter((panel): panel is PanelId => PANEL_IDS.includes(panel as PanelId) && !seen.has(panel as PanelId));
    panels.forEach((panel) => seen.add(panel));
    return [area, panels];
  })) as Record<AreaId, PanelId[]>;
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : fallback.id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : fallback.name,
    areas,
    directions: Object.fromEntries(AREA_IDS.map((area) => [area, value.directions?.[area] === 'column' ? 'column' : 'row'])) as Record<AreaId, AreaDirection>,
    ratios: {
      col: clamp(value.ratios?.col, fallback.ratios.col),
      left: clamp(value.ratios?.left, fallback.ratios.left),
      right: clamp(value.ratios?.right, fallback.ratios.right),
    },
    panelRatios: Object.fromEntries(AREA_IDS.map((area) => [
      area,
      normalizePanelRatios(value.panelRatios?.[area], areas[area].length, fallback.panelRatios[area]),
    ])) as Record<AreaId, number[]>,
  };
}

export function loadWorkspaces(): WorkspaceLayout[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.slice(0, 20).map((item, index) => normalizeWorkspace(item, DEFAULT_WORKSPACES[index] ?? DEFAULT_WORKSPACES[0]));
    }
  } catch {
    // Ungültige alte Einstellungen werden durch die Startansichten ersetzt.
  }
  const defaults = DEFAULT_WORKSPACES.map(cloneWorkspace);
  try {
    const legacy = JSON.parse(localStorage.getItem('panelLayout') ?? 'null');
    if (legacy) defaults[0].ratios = {
      col: clamp(legacy.col, DEFAULT_RATIOS.col),
      left: clamp(legacy.left, DEFAULT_RATIOS.left),
      right: clamp(legacy.right, DEFAULT_RATIOS.right),
    };
  } catch {
    // Die frühere Größenangabe ist optional.
  }
  return defaults;
}

export function saveWorkspaces(workspaces: WorkspaceLayout[]): void {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
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

export function workspaceUrl(id: string): string {
  const url = new URL(location.href);
  url.searchParams.set('workspace', id);
  return url.toString();
}

export function nextWorkspaceId(): string {
  return `ansicht-${Date.now().toString(36)}`;
}
