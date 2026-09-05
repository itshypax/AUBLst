import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionData } from '../lib/state.svelte';
import type { WorkspaceLayout } from '../lib/workspaces';
import WorkspaceGrid from './WorkspaceGrid.svelte';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('../lib/polling', () => ({ dismissLog: vi.fn(), refreshState: vi.fn() }));

beforeEach(() => resetSessionData());
afterEach(() => cleanup());

const layout: WorkspaceLayout = {
  id: 'test',
  name: 'Test',
  panels: [
    { key: 'events', type: 'events', x: 0, y: 0, w: 8, h: 8 },
    { key: 'logs', type: 'logs', x: 8, y: 0, w: 8, h: 8 },
    { key: 'vehicles', type: 'vehicles', x: 0, y: 8, w: 12, h: 8, settings: { vehiclesTab: 'rescue' } },
  ],
};

describe('Arbeitsfläche im Raster', () => {
  it('legt jedes Fenster auf seine Rasterposition und zeigt ohne Bearbeitung keine Griffe', () => {
    const { container } = render(WorkspaceGrid, { props: { layout, onChange: vi.fn() } });

    const events = container.querySelector('[data-panel-key="events"]') as HTMLElement;
    expect(events.style.gridColumn).toBe('1 / span 8');
    expect(events.style.gridRow).toBe('1 / span 8');
    expect(container.querySelectorAll('[data-grid-handle]')).toHaveLength(0);
  });

  it('hält eine Fahrzeugliste auf dem Tab Rettungsdienst fest', () => {
    render(WorkspaceGrid, { props: { layout, onChange: vi.fn() } });

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Rettungsdienst')).toBeTruthy();
  });

  it('verschiebt und vergrößert Fenster im Bearbeitungsmodus per Tastatur', async () => {
    const onChange = vi.fn();
    render(WorkspaceGrid, { props: { layout, editing: true, onChange } });

    const handle = screen.getByRole('button', { name: 'FMS-LOG anordnen' });
    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange.mock.calls[0][0].panels.find((panel: { key: string }) => panel.key === 'logs')).toMatchObject({ x: 9, y: 0 });

    await fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onChange.mock.calls[1][0].panels.find((panel: { key: string }) => panel.key === 'logs')).toMatchObject({ w: 9, h: 8 });
  });

  it('meldet Platzmangel statt zu überlappen', async () => {
    const onChange = vi.fn();
    const onNotice = vi.fn();
    render(WorkspaceGrid, { props: { layout, editing: true, onChange, onNotice } });

    await fireEvent.keyDown(screen.getByRole('button', { name: 'Einsätze anordnen' }), { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('Dort ist kein Platz für das Fenster.');
  });

  it('entfernt ein Fenster über den Griff und stellt den Fahrzeug-Tab um', async () => {
    const onChange = vi.fn();
    render(WorkspaceGrid, { props: { layout, editing: true, onChange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Einsätze entfernen' }));
    expect(onChange.mock.calls[0][0].panels.map((panel: { key: string }) => panel.key)).toEqual(['logs', 'vehicles']);

    await fireEvent.change(screen.getByLabelText('Tab für Fahrzeuge'), { target: { value: 'fire' } });
    expect(onChange.mock.calls[1][0].panels.find((panel: { key: string }) => panel.key === 'vehicles').settings).toEqual({ vehiclesTab: 'fire' });
  });
});
