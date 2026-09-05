import { beforeEach, describe, expect, it } from 'vitest';
import {
  addPanel,
  DEFAULT_WORKSPACES,
  findFreeSpot,
  GRID_COLUMNS,
  GRID_ROWS,
  LOCAL_MIRROR_KEY,
  loadWorkspaces,
  migrateLegacyWorkspace,
  movePanel,
  panelTypes,
  rectFits,
  removePanel,
  resetWorkspaceLayout,
  resizePanel,
  resizePanelRect,
  saveWorkspaces,
  stackedPanels,
  WORKSPACE_STORAGE_KEY,
  workspaceUrl,
  type WorkspaceLayout,
} from './workspaces';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

function overlaps(layout: WorkspaceLayout): boolean {
  return layout.panels.some((a, i) => layout.panels.some((b, j) => i !== j
    && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
}

describe('Arbeitsansichten im Raster', () => {
  it('liefert vier Vorlagen ohne Überlappung innerhalb des Rasters', () => {
    expect(DEFAULT_WORKSPACES.map((workspace) => workspace.id)).toEqual(['standard', 'einsatzmonitor', 'funkmonitor', 'leitstelle']);
    for (const workspace of DEFAULT_WORKSPACES) {
      expect(overlaps(workspace)).toBe(false);
      for (const panel of workspace.panels) {
        expect(panel.x + panel.w).toBeLessThanOrEqual(GRID_COLUMNS);
        expect(panel.y + panel.h).toBeLessThanOrEqual(GRID_ROWS);
      }
    }
  });

  it('enthält in der Standardansicht alle acht Panels genau einmal', () => {
    const [standard] = DEFAULT_WORKSPACES;
    expect(panelTypes(standard).sort()).toEqual(['bmas', 'current_event', 'events', 'hospitals', 'logs', 'map', 'speech_requests', 'vehicles']);
    expect(standard.panels.find((panel) => panel.type === 'map')?.x).toBeGreaterThan(GRID_COLUMNS / 2);
  });

  it('rechnet eine alte Ansicht mit vier Bereichen in das Raster um', () => {
    const migrated = migrateLegacyWorkspace({
      id: 'alt',
      name: 'Alte Ansicht',
      areas: { leftTop: ['map'], leftBottom: [], rightTop: ['events', 'logs'], rightBottom: ['hospitals'] },
      directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'column', rightBottom: 'row' },
      ratios: { col: 0.5, left: 0.5, right: 0.5 },
      panelRatios: { leftTop: [1], leftBottom: [], rightTop: [0.5, 0.5], rightBottom: [1] },
    });

    expect(migrated.id).toBe('alt');
    expect(overlaps(migrated)).toBe(false);
    expect(migrated.panels.find((panel) => panel.type === 'map')).toMatchObject({ x: 0, y: 0, w: 12, h: 16 });
    expect(migrated.panels.find((panel) => panel.type === 'events')).toMatchObject({ x: 12, y: 0, w: 12, h: 4 });
    expect(migrated.panels.find((panel) => panel.type === 'logs')).toMatchObject({ x: 12, y: 4, w: 12, h: 4 });
    expect(migrated.panels.find((panel) => panel.type === 'hospitals')).toMatchObject({ x: 12, y: 8, w: 12, h: 8 });
  });

  it('übernimmt alte Ansichten aus dem Fenster-Speicher und spiegelt den neuen Stand', () => {
    sessionStorage.setItem('leitstelleWorkspaces:v1', JSON.stringify([{
      id: 'standard',
      name: 'Meine alte',
      areas: { leftTop: ['events'], leftBottom: [], rightTop: ['map'], rightBottom: [] },
      directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
      ratios: { col: 0.5, left: 0.5, right: 0.5 },
      panelRatios: { leftTop: [1], leftBottom: [], rightTop: [1], rightBottom: [] },
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.name).toBe('Meine alte');
    expect(panelTypes(workspace)).toEqual(['events', 'map']);
    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '[]')[0].panels).toBeDefined();
    expect(JSON.parse(localStorage.getItem(LOCAL_MIRROR_KEY) ?? '[]')[0].name).toBe('Meine alte');
  });

  it('startet ein neues Fenster mit dem zuletzt gespiegelten Satz', () => {
    const custom = { ...DEFAULT_WORKSPACES[0], name: 'Letzter Stand' };
    saveWorkspaces([custom]);
    sessionStorage.clear();

    expect(loadWorkspaces()[0].name).toBe('Letzter Stand');
  });

  it('verwirft überlappende oder aus dem Raster ragende Panels beim Laden', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      id: 'kaputt',
      name: 'Kaputt',
      panels: [
        { key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 16 },
        { key: 'events', type: 'events', x: 6, y: 0, w: 12, h: 8 },
        { key: 'logs', type: 'logs', x: 20, y: 0, w: 8, h: 8 },
        { key: 'unsinn', type: 'unsinn', x: 12, y: 8, w: 4, h: 4 },
      ],
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panels.map((panel) => panel.key)).toEqual(['map']);
  });

  it('findet freie Stellen und fügt Panels dort ein', () => {
    const layout: WorkspaceLayout = { id: 'x', name: 'X', panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 16 }] };

    expect(findFreeSpot(layout, 6, 5)).toEqual({ x: 12, y: 0 });
    const added = addPanel(layout, 'vehicles')!;
    expect(added.panels).toHaveLength(2);
    expect(added.panels[1]).toMatchObject({ key: 'vehicles', type: 'vehicles', x: 12, y: 0, w: 6, h: 5 });
    expect(addPanel(added, 'vehicles')!.panels[2].key).toBe('vehicles-2');
    expect(overlaps(addPanel(added, 'vehicles')!)).toBe(false);
  });

  it('lehnt ein zweites Einsatzfenster ab und meldet Platzmangel', () => {
    const full: WorkspaceLayout = { id: 'x', name: 'X', panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 24, h: 16 }] };
    const withEvent: WorkspaceLayout = { id: 'y', name: 'Y', panels: [{ key: 'current_event', type: 'current_event', x: 0, y: 0, w: 6, h: 6 }] };

    expect(addPanel(full, 'vehicles')).toBeNull();
    expect(addPanel(withEvent, 'current_event')).toBeNull();
  });

  it('verschiebt nur auf freie Fläche und tauscht gleich große Panels', () => {
    const layout: WorkspaceLayout = {
      id: 'x',
      name: 'X',
      panels: [
        { key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 8 },
        { key: 'events', type: 'events', x: 12, y: 0, w: 12, h: 8 },
        { key: 'logs', type: 'logs', x: 0, y: 8, w: 6, h: 8 },
      ],
    };

    expect(movePanel(layout, 'logs', 8, 8)?.panels.find((panel) => panel.key === 'logs')).toMatchObject({ x: 8, y: 8 });
    expect(movePanel(layout, 'logs', 4, 4)).toBeNull();
    expect(movePanel(layout, 'logs', 22, 8)).toBeNull();
    const swapped = movePanel(layout, 'map', 12, 0)!;
    expect(swapped.panels.find((panel) => panel.key === 'map')).toMatchObject({ x: 12, y: 0 });
    expect(swapped.panels.find((panel) => panel.key === 'events')).toMatchObject({ x: 0, y: 0 });
  });

  it('ändert die Größe nur innerhalb des Rasters und ohne Überlappung', () => {
    const layout: WorkspaceLayout = {
      id: 'x',
      name: 'X',
      panels: [
        { key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 8 },
        { key: 'events', type: 'events', x: 12, y: 0, w: 12, h: 8 },
      ],
    };

    expect(resizePanel(layout, 'map', 12, 16)?.panels[0]).toMatchObject({ w: 12, h: 16 });
    expect(resizePanel(layout, 'map', 14, 8)).toBeNull();
    expect(resizePanel(layout, 'map', 2, 2)?.panels[0]).toMatchObject({ w: 3, h: 3 });
    expect(resizePanel(layout, 'events', 13, 8)).toBeNull();
    expect(rectFits(layout, { x: 0, y: 8, w: 24, h: 8 })).toBe(true);
  });

  it('setzt beim Ziehen an der linken oder oberen Kante Position und Größe zugleich', () => {
    const layout: WorkspaceLayout = {
      id: 'x',
      name: 'X',
      panels: [
        { key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 8 },
        { key: 'events', type: 'events', x: 14, y: 2, w: 10, h: 8 },
      ],
    };

    expect(resizePanelRect(layout, 'events', { x: 12, y: 2, w: 12, h: 8 })?.panels[1]).toMatchObject({ x: 12, w: 12 });
    expect(resizePanelRect(layout, 'events', { x: 14, y: 0, w: 10, h: 10 })?.panels[1]).toMatchObject({ y: 0, h: 10 });
    expect(resizePanelRect(layout, 'events', { x: 22, y: 2, w: 2, h: 8 })).toBeNull();
    expect(resizePanelRect(layout, 'events', { x: 10, y: 2, w: 14, h: 8 })).toBeNull();
    expect(resizePanelRect(layout, 'events', { x: 14, y: 2, w: 11, h: 8 })).toBeNull();
    expect(resizePanelRect(layout, 'events', { x: 14, y: 2, w: 10, h: 8 })?.panels[1]).toMatchObject({ x: 14, y: 2, w: 10, h: 8 });
  });

  it('entfernt Panels und stapelt sie für schmale Bildschirme nach Zeile und Spalte', () => {
    const [standard] = DEFAULT_WORKSPACES;
    const without = removePanel(standard, 'map');
    expect(panelTypes(without)).not.toContain('map');

    const order = stackedPanels(standard).map((panel) => `${panel.y}:${panel.x}`);
    expect([...order].sort((a, b) => {
      const [ay, ax] = a.split(':').map(Number);
      const [by, bx] = b.split(':').map(Number);
      return ay - by || ax - bx;
    })).toEqual(order);
  });

  it('setzt eine geänderte Vorlage auf ihre Ausgangsanordnung zurück', () => {
    const changed = { ...DEFAULT_WORKSPACES[0], name: 'Meine Standardansicht', panels: [DEFAULT_WORKSPACES[0].panels[0]] };

    expect(resetWorkspaceLayout(changed)).toEqual({ ...DEFAULT_WORKSPACES[0], name: 'Meine Standardansicht' });
  });

  it('übergibt eine Arbeitsansicht einmalig an einen neu geöffneten Tab', () => {
    const custom: WorkspaceLayout = { id: 'lagekarte', name: 'Lagekarte', panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 24, h: 16 }] };
    saveWorkspaces(DEFAULT_WORKSPACES);
    history.replaceState(null, '', workspaceUrl(custom));

    const loaded = loadWorkspaces();

    expect(loaded.find((workspace) => workspace.id === 'lagekarte')).toEqual(custom);
    expect(location.search).not.toContain('workspace_layout');
  });

  it('behält den Servercode und die Fahrzeug-Tab-Einstellung beim Laden', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      id: 'server',
      name: 'Vom Server',
      code: 'K7F2MX',
      panels: [{ key: 'vehicles', type: 'vehicles', x: 0, y: 0, w: 12, h: 16, settings: { vehiclesTab: 'rescue' } }],
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.code).toBe('K7F2MX');
    expect(workspace.panels[0].settings).toEqual({ vehiclesTab: 'rescue' });
  });

  it('kennt die Fahrzeugliste ohne Tabtrennung und verwirft unbekannte Werte', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      id: 'mixed',
      name: 'Gemischt',
      panels: [
        { key: 'vehicles', type: 'vehicles', x: 0, y: 0, w: 12, h: 8, settings: { vehiclesTab: 'all' } },
        { key: 'vehicles-2', type: 'vehicles', x: 0, y: 8, w: 12, h: 8, settings: { vehiclesTab: 'x' } },
      ],
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panels[0].settings).toEqual({ vehiclesTab: 'all' });
    expect(workspace.panels[1].settings?.vehiclesTab).toBeUndefined();
  });
});

import { sharedLayoutCodeFromUrl } from './workspaces';

describe('Geteilter Layout-Code in der URL', () => {
  it('liest den Code einmalig aus und entfernt ihn aus der Adresse', () => {
    history.replaceState(null, '', '/?layout=k7f2mx&workspace=standard');

    expect(sharedLayoutCodeFromUrl()).toBe('K7F2MX');
    expect(location.search).toBe('?workspace=standard');
    expect(sharedLayoutCodeFromUrl()).toBeNull();
  });

  it('ignoriert unbrauchbare Codes', () => {
    history.replaceState(null, '', '/?layout=zu-lang-und-falsch');

    expect(sharedLayoutCodeFromUrl()).toBeNull();
  });
});

describe('Einstellungen je Fenster', () => {
  it('behält Kartenfilter und Einsatzfilter und verwirft Unbrauchbares', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      id: 'x',
      name: 'X',
      panels: [
        { key: 'map', type: 'map', x: 0, y: 0, w: 12, h: 16, settings: { mapFilters: { showVehicles: false, hiddenStatuses: [3, 'x', 99], hiddenCategories: ['fire', 12], hiddenStations: ['2'] }, vehiclesTab: 'fire' } },
        { key: 'events', type: 'events', x: 12, y: 0, w: 12, h: 16, settings: { eventsFilters: ['new', 'nope'] } },
      ],
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panels[0].settings).toEqual({ mapFilters: { showVehicles: false, hiddenStatuses: [3], hiddenCategories: ['fire'], hiddenStations: ['2'] } });
    expect(workspace.panels[1].settings).toEqual({ eventsFilters: ['new'] });
  });
});
