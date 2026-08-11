import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACES, loadWorkspaces, saveWorkspaces, WORKSPACE_STORAGE_KEY } from './workspaces';

beforeEach(() => localStorage.clear());

describe('Arbeitsansichten', () => {
  it('bildet die bisherige Aufteilung als Standardansicht ab', () => {
    const [standard] = loadWorkspaces();

    expect(standard.areas).toEqual({
      leftTop: ['map'],
      leftBottom: ['logs', 'hospitals'],
      rightTop: ['vehicles'],
      rightBottom: ['events'],
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
      areas: { ...DEFAULT_WORKSPACES[0].areas, rightTop: ['vehicles', 'map'] },
    }]));

    const [workspace] = loadWorkspaces();
    expect(workspace.areas.leftTop).toEqual(['map']);
    expect(workspace.areas.rightTop).toEqual(['vehicles']);
  });
});
