import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Tooltip from './Tooltip.svelte';

afterEach(() => cleanup());

describe('Leitstellen-Tooltip', () => {
  it('zeigt Hinweise bei Tastaturfokus und verknüpft sie mit dem Auslöser', async () => {
    render(Tooltip);
    const button = document.createElement('button');
    button.dataset.tooltip = 'Daten neu laden';
    button.textContent = 'Neu laden';
    document.body.append(button);

    button.focus();

    expect((await screen.findByRole('tooltip')).textContent).toBe('Daten neu laden');
    expect(button.getAttribute('aria-describedby')).toContain('app-tooltip');

    button.blur();
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    button.remove();
  });

  it('holt nach einem Mausklick keinen alten Fokus-Tooltip zurück', async () => {
    render(Tooltip);
    const settings = document.createElement('button');
    settings.dataset.tooltip = 'Verbindung und Ton einstellen';
    const reload = document.createElement('button');
    reload.dataset.tooltip = 'Daten neu laden';
    document.body.append(settings, reload);

    settings.focus();
    expect((await screen.findByRole('tooltip')).textContent).toBe('Verbindung und Ton einstellen');

    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();

    await fireEvent.pointerOver(reload);
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Daten neu laden'));
    await fireEvent.pointerOut(reload, { relatedTarget: document.body });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    settings.remove();
    reload.remove();
  });
});
