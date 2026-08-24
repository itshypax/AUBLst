import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACES, loadWorkspaces, resetWorkspaceLayout, saveWorkspaces, WORKSPACE_STORAGE_KEY, workspaceUrl, type WorkspaceLayout } from './workspaces';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

describe('Arbeitsansichten', () => {
  it('bildet die Dispositionsansicht als Standardansicht ab', () => {
    const [standard] = loadWorkspaces();

    expect(standard.areas).toEqual({
      leftTop: ['events', 'bmas', 'speech_requests', 'current_event'],
      leftBottom: ['hospitals', 'logs'],
      rightTop: ['vehicles'],
      rightBottom: ['map'],
    });
    expect(standard.directions.leftTop).toBe('mosaic');
  });

  it('speichert Arbeitsansichten nur im aktuellen Fenster', () => {
    saveWorkspaces(DEFAULT_WORKSPACES);

    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '[]')).toHaveLength(4);
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(loadWorkspaces().map((workspace) => workspace.id)).toEqual(['standard', 'einsatzmonitor', 'funkmonitor', 'leitstelle']);
  });

  it('lässt den aktuellen Einsatz in der kompakten Ansicht über die volle rechte Höhe laufen', () => {
    const compact = loadWorkspaces().find((workspace) => workspace.id === 'leitstelle');

    expect(compact?.areas).toEqual({
      leftTop: ['events'],
      leftBottom: ['bmas', 'speech_requests'],
      rightTop: ['current_event'],
      rightBottom: [],
    });
  });

  it('stellt die ältere kompakte Ansicht auf das durchgehende Einsatzfenster um', () => {
    const current = DEFAULT_WORKSPACES.find((workspace) => workspace.id === 'leitstelle')!;
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...current,
      areas: { ...current.areas, rightBottom: ['hospitals', 'logs'] },
      panelRatios: { ...current.panelRatios, rightBottom: [0.64, 0.36] },
    }]));

    expect(loadWorkspaces()[0].areas.rightBottom).toEqual([]);
  });

  it('entfernt doppelt eingetragene Panels beim Laden', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...DEFAULT_WORKSPACES[0],
      areas: { ...DEFAULT_WORKSPACES[0].areas, rightTop: ['vehicles', 'events'] },
    }]));

    const [workspace] = loadWorkspaces();
    expect(workspace.areas.leftTop).toEqual(['events', 'bmas', 'speech_requests', 'current_event']);
    expect(workspace.areas.rightTop).toEqual(['vehicles']);
  });

  it('ergänzt für alte Arbeitsansichten Größenanteile je Modul', () => {
    const legacy = { ...DEFAULT_WORKSPACES[0] } as Partial<(typeof DEFAULT_WORKSPACES)[number]>;
    delete legacy.panelRatios;
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([legacy]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panelRatios.leftTop).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(workspace.panelRatios.leftBottom).toEqual([0.5, 0.5]);
  });

  it('setzt das Sprechwunsch-Panel in eine ältere Standardansicht ein', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...DEFAULT_WORKSPACES[0],
      areas: { ...DEFAULT_WORKSPACES[0].areas, leftBottom: ['logs', 'hospitals'] },
      panelRatios: { ...DEFAULT_WORKSPACES[0].panelRatios, leftBottom: [0.5, 0.5] },
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.areas.leftTop).toEqual(['events', 'bmas', 'speech_requests', 'current_event']);
    expect(workspace.areas.leftBottom).toEqual(['hospitals', 'logs']);
    expect(workspace.panelRatios.leftBottom).toEqual([0.5, 0.5]);
  });

  it('übernimmt die neue Anordnung in eine bisherige Standardansicht', () => {
    const current = DEFAULT_WORKSPACES[0];
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...current,
      areas: {
        leftTop: ['events', 'current_event'],
        leftBottom: ['logs', 'speech_requests', 'bmas', 'hospitals'],
        rightTop: ['vehicles'],
        rightBottom: ['map'],
      },
      directions: { leftTop: 'row', leftBottom: 'row', rightTop: 'row', rightBottom: 'row' },
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.areas).toEqual(current.areas);
    expect(workspace.directions.leftTop).toBe('mosaic');
  });

  it('stellt die untere Reihenfolge im Standardlayout auf Krankenhäuser und FMS-LOG um', () => {
    const current = DEFAULT_WORKSPACES[0];
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...current,
      areas: { ...current.areas, leftBottom: ['logs', 'hospitals'] },
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.areas.leftBottom).toEqual(['hospitals', 'logs']);
  });

  it('verwirft die verschachtelte Anordnung ohne genau vier Fenster', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...DEFAULT_WORKSPACES[1],
      directions: { ...DEFAULT_WORKSPACES[1].directions, leftTop: 'mosaic' },
    }]));

    expect(loadWorkspaces()[0].directions.leftTop).toBe('row');
  });

  it('setzt eine geänderte Ansicht vollständig auf ihre Vorlage zurück', () => {
    const changed: WorkspaceLayout = {
      ...DEFAULT_WORKSPACES[0],
      name: 'Meine Standardansicht',
      areas: { ...DEFAULT_WORKSPACES[0].areas, leftTop: ['map'], rightBottom: [] },
      directions: { ...DEFAULT_WORKSPACES[0].directions, leftTop: 'row' },
      ratios: { col: 0.3, left: 0.3, right: 0.3 },
      panelRatios: { ...DEFAULT_WORKSPACES[0].panelRatios, leftTop: [1], rightBottom: [] },
    };

    const reset = resetWorkspaceLayout(changed);

    expect(reset).toEqual({ ...DEFAULT_WORKSPACES[0], name: 'Meine Standardansicht' });
  });

  it('übernimmt bestehende browserweite Einstellungen einmalig in das aktuelle Fenster', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{ ...DEFAULT_WORKSPACES[0], name: 'Bisherige Ansicht' }]));

    expect(loadWorkspaces()[0].name).toBe('Bisherige Ansicht');
    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '[]')[0].name).toBe('Bisherige Ansicht');

    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{ ...DEFAULT_WORKSPACES[0], name: 'Anderes Fenster' }]));
    expect(loadWorkspaces()[0].name).toBe('Bisherige Ansicht');
  });

  it('übergibt eine Arbeitsansicht einmalig an einen neu geöffneten Tab', () => {
    const custom: WorkspaceLayout = {
      ...DEFAULT_WORKSPACES[0],
      id: 'lagekarte',
      name: 'Lagekarte',
      areas: { ...DEFAULT_WORKSPACES[0].areas, leftTop: ['map'], rightBottom: [] },
      directions: { ...DEFAULT_WORKSPACES[0].directions, leftTop: 'row' },
      panelRatios: { ...DEFAULT_WORKSPACES[0].panelRatios, leftTop: [1], rightBottom: [] },
    };
    saveWorkspaces(DEFAULT_WORKSPACES);
    history.replaceState(null, '', workspaceUrl(custom));

    const loaded = loadWorkspaces();

    expect(loaded.find((workspace) => workspace.id === 'lagekarte')).toEqual(custom);
    expect(location.search).not.toContain('workspace_layout');
  });
});
