import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACES, loadWorkspaces, saveWorkspaces, WORKSPACE_STORAGE_KEY } from './workspaces';

beforeEach(() => localStorage.clear());

describe('Arbeitsansichten', () => {
  it('bildet die Dispositionsansicht als Standardansicht ab', () => {
    const [standard] = loadWorkspaces();

    expect(standard.areas).toEqual({
      leftTop: ['events', 'current_event'],
      leftBottom: ['logs', 'hospitals'],
      rightTop: ['vehicles'],
      rightBottom: ['map'],
    });
  });

  it('speichert unterschiedliche Monitoransichten gemeinsam', () => {
    saveWorkspaces(DEFAULT_WORKSPACES);

    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '[]')).toHaveLength(3);
    expect(loadWorkspaces().map((workspace) => workspace.id)).toEqual(['standard', 'einsatzmonitor', 'funkmonitor']);
  });

  it('entfernt doppelt eingetragene Panels beim Laden', () => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([{
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
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify([legacy]));

    const [workspace] = loadWorkspaces();

    expect(workspace.panelRatios.leftTop).toEqual([0.34, 0.66]);
    expect(workspace.panelRatios.leftBottom).toEqual([0.5, 0.5]);
  });
});
