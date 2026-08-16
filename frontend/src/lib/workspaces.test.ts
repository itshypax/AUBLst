import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACES, loadWorkspaces, saveWorkspaces, WORKSPACE_STORAGE_KEY, workspaceUrl, type WorkspaceLayout } from './workspaces';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

describe('Arbeitsansichten', () => {
  it('bildet die Dispositionsansicht als Standardansicht ab', () => {
    const [standard] = loadWorkspaces();

    expect(standard.areas).toEqual({
      leftTop: ['events', 'current_event'],
      leftBottom: ['logs', 'speech_requests', 'hospitals'],
      rightTop: ['vehicles'],
      rightBottom: ['map'],
    });
  });

  it('speichert Arbeitsansichten nur im aktuellen Fenster', () => {
    saveWorkspaces(DEFAULT_WORKSPACES);

    expect(JSON.parse(sessionStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '[]')).toHaveLength(3);
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(loadWorkspaces().map((workspace) => workspace.id)).toEqual(['standard', 'einsatzmonitor', 'funkmonitor']);
  });

  it('entfernt doppelt eingetragene Panels beim Laden', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...DEFAULT_WORKSPACES[0],
      areas: { ...DEFAULT_WORKSPACES[0].areas, rightTop: ['vehicles', 'events'] },
    }]));

    const [workspace] = loadWorkspaces();
    expect(workspace.areas.leftTop).toEqual(['events', 'current_event']);
    expect(workspace.areas.rightTop).toEqual(['vehicles']);
  });

  it('ergänzt für alte Arbeitsansichten Größenanteile je Modul', () => {
    const legacy = { ...DEFAULT_WORKSPACES[0] } as Partial<(typeof DEFAULT_WORKSPACES)[number]>;
    delete legacy.panelRatios;
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([legacy]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panelRatios.leftTop).toEqual([0.34, 0.66]);
    expect(workspace.panelRatios.leftBottom).toEqual([0.42, 0.22, 0.36]);
  });

  it('setzt das Sprechwunsch-Panel in eine ältere Standardansicht ein', () => {
    sessionStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
      ...DEFAULT_WORKSPACES[0],
      areas: { ...DEFAULT_WORKSPACES[0].areas, leftBottom: ['logs', 'hospitals'] },
      panelRatios: { ...DEFAULT_WORKSPACES[0].panelRatios, leftBottom: [0.5, 0.5] },
    }]));

    const [workspace] = loadWorkspaces();

    expect(workspace.areas.leftBottom).toEqual(['logs', 'speech_requests', 'hospitals']);
    expect(workspace.panelRatios.leftBottom).toEqual([0.42, 0.22, 0.36]);
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
      panelRatios: { ...DEFAULT_WORKSPACES[0].panelRatios, leftTop: [1], rightBottom: [] },
    };
    saveWorkspaces(DEFAULT_WORKSPACES);
    history.replaceState(null, '', workspaceUrl(custom));

    const loaded = loadWorkspaces();

    expect(loaded.find((workspace) => workspace.id === 'lagekarte')).toEqual(custom);
    expect(location.search).not.toContain('workspace_layout');
  });
});
