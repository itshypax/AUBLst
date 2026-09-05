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

    await fireEvent.change(screen.getByLabelText('Tab für Fahrzeuge'), { target: { value: 'all' } });
    expect(onChange.mock.calls[2][0].panels.find((panel: { key: string }) => panel.key === 'vehicles').settings).toEqual({ vehiclesTab: 'all' });
  });

  it('zeichnet das Raster nur im Bearbeitungsmodus', () => {
    const { container, unmount } = render(WorkspaceGrid, { props: { layout, onChange: vi.fn() } });
    expect(container.querySelector('.grid-lines')).toBeNull();
    unmount();

    const edited = render(WorkspaceGrid, { props: { layout, editing: true, onChange: vi.fn() } });
    expect(edited.container.querySelector('.grid-lines')).not.toBeNull();
  });
});

// Arbeitsfläche 2400 x 1600 Pixel, damit eine Rasterzelle 100 x 100 misst.
function mockGridSize(container: HTMLElement): void {
  const grid = container.querySelector('.workspace-grid') as HTMLElement;
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 2400, bottom: 1600, width: 2400, height: 1600, toJSON: () => ({}),
  });
}

function panelOf(container: HTMLElement, key: string): HTMLElement {
  return container.querySelector(`[data-panel-key="${key}"]`) as HTMLElement;
}

describe('Ziehen mit Live-Vorschau', () => {
  it('rückt das Fenster schon beim Ziehen an die Zielzelle und übernimmt beim Loslassen', async () => {
    const onChange = vi.fn();
    const { container } = render(WorkspaceGrid, { props: { layout, editing: true, onChange } });
    mockGridSize(container);
    const grid = container.querySelector('.workspace-grid') as HTMLElement;

    await fireEvent.pointerDown(screen.getByRole('button', { name: 'FMS-LOG anordnen' }), { button: 0, clientX: 850, clientY: 20, pointerId: 1 });
    await fireEvent.pointerMove(grid, { clientX: 950, clientY: 20, pointerId: 1 });

    expect(panelOf(container, 'logs').style.gridColumn).toBe('10 / span 8');
    expect(container.querySelector('.ghost-target')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].panels.find((panel: { key: string }) => panel.key === 'logs')).toMatchObject({ x: 9, y: 0 });
  });

  it('lässt das Fenster bei Platzmangel an der letzten passenden Stelle und meldet das', async () => {
    const onChange = vi.fn();
    const onNotice = vi.fn();
    const { container } = render(WorkspaceGrid, { props: { layout, editing: true, onChange, onNotice } });
    mockGridSize(container);
    const grid = container.querySelector('.workspace-grid') as HTMLElement;

    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Einsätze anordnen' }), { button: 0, clientX: 50, clientY: 20, pointerId: 1 });
    await fireEvent.pointerMove(grid, { clientX: 150, clientY: 20, pointerId: 1 });

    const events = panelOf(container, 'events');
    expect(events.style.gridColumn).toBe('1 / span 8');
    expect(events.classList.contains('invalid')).toBe(true);

    await fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('Dort ist kein Platz für das Fenster.');
  });

  it('vergrößert an der linken Kante und verschiebt dabei die Position', async () => {
    const onChange = vi.fn();
    const spaced: WorkspaceLayout = { ...layout, panels: [layout.panels[0], { ...layout.panels[1], x: 10 }] };
    const { container } = render(WorkspaceGrid, { props: { layout: spaced, editing: true, onChange } });
    mockGridSize(container);
    const grid = container.querySelector('.workspace-grid') as HTMLElement;
    const handle = panelOf(container, 'logs').querySelector('[data-resize="w"]') as HTMLElement;

    await fireEvent.pointerDown(handle, { button: 0, clientX: 1000, clientY: 400, pointerId: 1 });
    await fireEvent.pointerMove(grid, { clientX: 900, clientY: 400, pointerId: 1 });
    expect(panelOf(container, 'logs').style.gridColumn).toBe('10 / span 9');

    await fireEvent.pointerUp(grid, { pointerId: 1 });
    expect(onChange.mock.calls[0][0].panels.find((panel: { key: string }) => panel.key === 'logs')).toMatchObject({ x: 9, y: 0, w: 9, h: 8 });
  });

  it('bietet acht Griffe je Fenster', () => {
    const { container } = render(WorkspaceGrid, { props: { layout, editing: true, onChange: vi.fn() } });
    const edges = [...panelOf(container, 'logs').querySelectorAll('[data-resize]')].map((el) => el.getAttribute('data-resize'));
    expect(edges.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });
});

describe('Einstellungen je Fenster im Raster', () => {
  it('startet die Einsatzliste mit den gespeicherten Filtern und schreibt Änderungen zurück', async () => {
    const onChange = vi.fn();
    const withEvents: WorkspaceLayout = {
      id: 'x',
      name: 'X',
      panels: [{ key: 'events', type: 'events', x: 0, y: 0, w: 12, h: 16, settings: { eventsFilters: ['new'] } }],
    };
    render(WorkspaceGrid, { props: { layout: withEvents, onChange } });

    expect(screen.getByRole('button', { name: /^Neu/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Aktuell/ }).getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(screen.getByRole('button', { name: /^Aktuell/ }));

    expect(onChange.mock.calls[0][0].panels[0].settings).toEqual({ eventsFilters: ['new', 'current'] });
  });
});
