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
export const AREA_IDS = ['leftTop', 'leftBottom', 'rightTop', 'rightBottom'] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type AreaId = (typeof AREA_IDS)[number];
export type AreaDirection = 'row' | 'column' | 'mosaic';

export interface WorkspaceLayout {
  id: string;
  name: string;
  areas: Record<AreaId, PanelId[]>;
  directions: Record<AreaId, AreaDirection>;
  ratios: { col: number; left: number; right: number };
  panelRatios: Record<AreaId, number[]>;
}

export const WORKSPACE_STORAGE_KEY = 'leitstelleWorkspaces:v1';
const WORKSPACE_TRANSFER_PARAM = 'workspace_layout';

const DEFAULT_RATIOS = { col: 0.58, left: 0.62, right: 0.55 };

export const DEFAULT_WORKSPACES: WorkspaceLayout[] = [
  {
    id: 'standard',
    name: 'Standard',
    areas: {
      leftTop: ['events', 'bmas', 'speech_requests', 'current_event'],
      leftBottom: ['hospitals', 'logs'],
      rightTop: ['vehicles'],
      rightBottom: ['map'],
    },
    directions: { leftTop: 'mosaic', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    ratios: DEFAULT_RATIOS,
    panelRatios: { leftTop: [0.25, 0.25, 0.25, 0.25], leftBottom: [0.5, 0.5], rightTop: [1], rightBottom: [1] },
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
  {
    id: 'leitstelle',
    name: 'Leitstelle kompakt',
    areas: {
      leftTop: ['events'],
      leftBottom: ['bmas', 'speech_requests'],
      rightTop: ['current_event'],
      rightBottom: [],
    },
    directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    ratios: { col: 0.39, left: 0.56, right: 0.5 },
    panelRatios: { leftTop: [1], leftBottom: [0.44, 0.56], rightTop: [1], rightBottom: [] },
  },
];

function clamp(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.85, Math.max(0.15, number)) : fallback;
}

function normalizePanelRatios(value: unknown, count: number, fallback: number[] = []): number[] {
  if (!count) return [];
  const candidates =
    Array.isArray(value) && value.length === count
      ? value.map(Number)
      : fallback.length === count
        ? fallback
        : Array(count).fill(1);
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
    panelRatios: Object.fromEntries(AREA_IDS.map((area) => [area, [...layout.panelRatios[area]]])) as Record<
      AreaId,
      number[]
    >,
  };
}

export function resetWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  const preset = DEFAULT_WORKSPACES.find((workspace) => workspace.id === layout.id) ?? DEFAULT_WORKSPACES[0];
  return { ...cloneWorkspace(preset), id: layout.id, name: layout.name };
}

function normalizeWorkspace(value: Partial<WorkspaceLayout>, fallback: WorkspaceLayout): WorkspaceLayout {
  const seen = new Set<PanelId>();
  const legacyStandard =
    value.id === 'standard' && !AREA_IDS.some((area) => value.areas?.[area]?.includes('current_event'));
  const legacyStandardRows = value.id === 'standard'
    && value.areas?.leftTop?.join(',') === 'events,current_event'
    && value.areas?.rightTop?.join(',') === 'vehicles'
    && value.areas?.rightBottom?.join(',') === 'map';
  const legacyStandardMosaicOrder = value.id === 'standard'
    && value.areas?.leftTop?.join(',') === 'events,bmas,speech_requests,current_event'
    && value.areas?.leftBottom?.join(',') === 'logs,hospitals'
    && value.areas?.rightTop?.join(',') === 'vehicles'
    && value.areas?.rightBottom?.join(',') === 'map';
  const legacyCompact = value.id === 'leitstelle'
    && value.areas?.leftTop?.join(',') === 'events'
    && value.areas?.leftBottom?.join(',') === 'bmas,speech_requests'
    && value.areas?.rightTop?.join(',') === 'current_event'
    && value.areas?.rightBottom?.join(',') === 'hospitals,logs';
  const areas = Object.fromEntries(
    AREA_IDS.map((area) => {
      const candidates = legacyStandard || legacyStandardRows || legacyStandardMosaicOrder || legacyCompact
        ? fallback.areas[area]
        : Array.isArray(value.areas?.[area])
          ? value.areas[area]
          : fallback.areas[area];
      const panels = candidates.filter(
        (panel): panel is PanelId => PANEL_IDS.includes(panel as PanelId) && !seen.has(panel as PanelId),
      );
      panels.forEach((panel) => seen.add(panel));
      return [area, panels];
    }),
  ) as Record<AreaId, PanelId[]>;
  if (value.id === 'standard' && !seen.has('speech_requests')) {
    const logsArea = AREA_IDS.find((area) => areas[area].includes('logs')) ?? 'leftBottom';
    const panels = [...areas[logsArea]];
    const logsIndex = panels.indexOf('logs');
    panels.splice(logsIndex + 1, 0, 'speech_requests');
    areas[logsArea] = panels;
    seen.add('speech_requests');
  }
  if (value.id === 'standard' && !seen.has('bmas')) {
    const speechArea = AREA_IDS.find((area) => areas[area].includes('speech_requests')) ?? 'leftBottom';
    const panels = [...areas[speechArea]];
    panels.splice(panels.indexOf('speech_requests') + 1, 0, 'bmas');
    areas[speechArea] = panels;
    seen.add('bmas');
  }
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : fallback.id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : fallback.name,
    areas,
    directions: Object.fromEntries(
      AREA_IDS.map((area) => {
        if (legacyStandard || legacyStandardRows || legacyStandardMosaicOrder || legacyCompact) return [area, fallback.directions[area]];
        const direction = value.directions?.[area];
        if (direction === 'column') return [area, 'column'];
        if (direction === 'mosaic' && areas[area].length === 4) return [area, 'mosaic'];
        return [area, 'row'];
      }),
    ) as Record<AreaId, AreaDirection>,
    ratios: {
      col: clamp(value.ratios?.col, fallback.ratios.col),
      left: clamp(value.ratios?.left, fallback.ratios.left),
      right: clamp(value.ratios?.right, fallback.ratios.right),
    },
    panelRatios: Object.fromEntries(
      AREA_IDS.map((area) => [
        area,
        normalizePanelRatios(value.panelRatios?.[area], areas[area].length, fallback.panelRatios[area]),
      ]),
    ) as Record<AreaId, number[]>,
  };
}

export function loadWorkspaces(): WorkspaceLayout[] {
  let initial: WorkspaceLayout[] | null = null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.length) {
      initial = parsed
        .slice(0, 20)
        .map((item, index) => normalizeWorkspace(
          item,
          DEFAULT_WORKSPACES.find((workspace) => workspace.id === item?.id) ?? DEFAULT_WORKSPACES[index] ?? DEFAULT_WORKSPACES[0],
        ));
    }
  } catch {
    // Ungültige Einstellungen werden durch die Startansichten ersetzt.
  }

  if (!initial) {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null');
      if (Array.isArray(parsed) && parsed.length) {
        initial = parsed
          .slice(0, 20)
          .map((item, index) => normalizeWorkspace(
            item,
            DEFAULT_WORKSPACES.find((workspace) => workspace.id === item?.id) ?? DEFAULT_WORKSPACES[index] ?? DEFAULT_WORKSPACES[0],
          ));
      }
    } catch {
      // Bestehende browserweite Einstellungen werden einmalig übernommen.
    }
  }

  if (!initial) {
    initial = DEFAULT_WORKSPACES.map(cloneWorkspace);
    try {
      const legacy = JSON.parse(localStorage.getItem('panelLayout') ?? 'null');
      if (legacy)
        initial[0].ratios = {
          col: clamp(legacy.col, DEFAULT_RATIOS.col),
          left: clamp(legacy.left, DEFAULT_RATIOS.left),
          right: clamp(legacy.right, DEFAULT_RATIOS.right),
        };
    } catch {
      // Die frühere Größenangabe ist optional.
    }
  }

  const transferred = workspaceFromUrl();
  if (transferred) {
    const fallback = DEFAULT_WORKSPACES.find((workspace) => workspace.id === transferred.id) ?? DEFAULT_WORKSPACES[0];
    const workspace = normalizeWorkspace(transferred, fallback);
    const index = initial.findIndex((item) => item.id === workspace.id);
    initial =
      index === -1 ? [...initial, workspace] : initial.map((item) => (item.id === workspace.id ? workspace : item));
  }

  saveWorkspaces(initial);
  return initial;
}

export function saveWorkspaces(workspaces: WorkspaceLayout[]): void {
  sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces));
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

function workspaceFromUrl(): Partial<WorkspaceLayout> | null {
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
