import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACES } from '../lib/workspaces';
import WorkspaceEditorModal from './WorkspaceEditorModal.svelte';

afterEach(() => cleanup());

function renderEditor() {
  return render(WorkspaceEditorModal, {
    props: {
      workspaces: DEFAULT_WORKSPACES,
      activeId: 'standard',
      onSelect: vi.fn(),
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onOpenTab: vi.fn(),
      onClose: vi.fn(),
    },
  });
}

function panelNames(group: Element): string[] {
  return Array.from(group.querySelectorAll('.panel-name'), (element) => element.textContent ?? '');
}

describe('Arbeitsansicht bearbeiten', () => {
  it('gruppiert Fenster nach Bereich und zeigt ihre wirkliche Reihenfolge', () => {
    const { container } = renderEditor();
    const leftTop = container.querySelector('[data-area="leftTop"]');

    expect(leftTop).not.toBeNull();
    expect(panelNames(leftTop!)).toEqual(['Einsätze', 'BMAs', 'Sprechwünsche', 'Aktueller Einsatz']);
    expect(Array.from(leftTop!.querySelectorAll('.position-number'), (element) => element.textContent)).toEqual(['1', '2', '3', '4']);
    expect(panelNames(container.querySelector('[data-area="leftBottom"]')!)).toEqual(['Krankenhäuser', 'FMS-LOG']);
  });

  it('aktualisiert die sortierte Liste direkt beim Verschieben', async () => {
    const { container } = renderEditor();

    await fireEvent.click(screen.getByRole('button', { name: 'BMAs nach vorne' }));

    expect(panelNames(container.querySelector('[data-area="leftTop"]')!)).toEqual(['BMAs', 'Einsätze', 'Sprechwünsche', 'Aktueller Einsatz']);
  });
});
