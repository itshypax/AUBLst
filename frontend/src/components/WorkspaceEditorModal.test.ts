import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import { DEFAULT_WORKSPACES, type WorkspaceLayout } from '../lib/workspaces';
import WorkspaceEditorModal from './WorkspaceEditorModal.svelte';

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.connected = true;
  app.lastSuccessfulSync = Date.now();
  library.fetchLayoutList.mockReset().mockResolvedValue([]);
  library.fetchLayout.mockReset();
  library.saveLayoutToServer.mockReset();
  library.deleteLayoutFromServer.mockReset();
});

afterEach(() => cleanup());

function renderEditor(overrides: { workspaces?: WorkspaceLayout[] } = {}) {
  const props = {
    workspaces: DEFAULT_WORKSPACES,
    activeId: 'standard',
    onSelect: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onOpenTab: vi.fn(),
    onEditLayout: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(WorkspaceEditorModal, { props }), props };
}

describe('Ansichten-Dialog', () => {
  it('listet alle Ansichten mit ihren Fenstern und markiert die aktive', () => {
    renderEditor();

    const rows = screen.getAllByRole('button', { name: /Standard|Einsatzmonitor|Fahrzeuge und Funk|Leitstelle kompakt/ });
    expect(rows).toHaveLength(4);
    expect(screen.getByRole('button', { name: /^Standard/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: /^Einsatzmonitor/ }).textContent).toContain('Karte, Einsätze');
  });

  it('benennt die aktive Ansicht beim Verlassen des Feldes um', async () => {
    const { props } = renderEditor();

    const input = screen.getByLabelText('Name der Ansicht');
    await fireEvent.input(input, { target: { value: 'Meine Disposition' } });
    await fireEvent.blur(input);

    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'standard', name: 'Meine Disposition' }));
  });

  it('startet den Bearbeitungsmodus für die Anordnung', async () => {
    const { props } = renderEditor();

    await fireEvent.click(screen.getByRole('button', { name: 'Anordnung bearbeiten' }));

    expect(props.onEditLayout).toHaveBeenCalledOnce();
  });

  it('dupliziert ohne den Servercode zu übernehmen', async () => {
    const { props } = renderEditor({
      workspaces: [{ ...DEFAULT_WORKSPACES[0], code: 'K7F2MX' }],
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Duplizieren' }));

    const copy = props.onSave.mock.calls[0][0];
    expect(copy.name).toBe('Standard Kopie');
    expect(copy.code).toBeUndefined();
    expect(copy.id).not.toBe('standard');
    expect(props.onSelect).toHaveBeenCalledWith(copy.id);
  });
});

const library = vi.hoisted(() => ({
  fetchLayoutList: vi.fn(),
  fetchLayout: vi.fn(),
  saveLayoutToServer: vi.fn(),
  deleteLayoutFromServer: vi.fn(),
  layoutShareUrl: vi.fn((code: string) => `http://localhost/?layout=${code}`),
}));
vi.mock('../lib/layout-library', () => library);

describe('Server-Bibliothek im Ansichten-Dialog', () => {
  it('listet Layouts vom Server und übernimmt eines lokal', async () => {
    library.fetchLayoutList.mockResolvedValue([{ code: 'K7F2MX', name: 'Wachraum', mod_id: null, updated_at: '2026-09-05 10:00:00' }]);
    const serverLayout = { id: 'server-k7f2mx', name: 'Wachraum', code: 'K7F2MX', panels: [{ key: 'map', type: 'map', x: 0, y: 0, w: 24, h: 16 }] };
    library.fetchLayout.mockResolvedValue(serverLayout);
    const { props } = renderEditor();

    await screen.findByText('Wachraum');
    await fireEvent.click(screen.getByRole('button', { name: 'Wachraum laden' }));
    await screen.findByText('Wachraum');

    expect(library.fetchLayout).toHaveBeenCalledWith('K7F2MX');
    expect(props.onSave).toHaveBeenCalledWith(serverLayout);
    expect(props.onSelect).toHaveBeenCalledWith('server-k7f2mx');
  });

  it('speichert die aktive Ansicht auf dem Server und merkt sich den Code', async () => {
    library.fetchLayoutList.mockResolvedValue([]);
    library.saveLayoutToServer.mockResolvedValue({ ...DEFAULT_WORKSPACES[0], code: 'NEU123' });
    const { props } = renderEditor();
    await screen.findByText('Noch keine Layouts auf dem Server.');

    await fireEvent.click(screen.getByRole('button', { name: 'Auf Server speichern' }));
    await vi.waitFor(() => expect(props.onSave).toHaveBeenCalled());

    expect(library.saveLayoutToServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'standard' }), false);
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ code: 'NEU123' }));
  });
});
