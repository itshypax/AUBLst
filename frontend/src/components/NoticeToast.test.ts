import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, showNotice } from '../lib/state.svelte';
import NoticeToast from './NoticeToast.svelte';

beforeEach(() => {
  vi.useFakeTimers();
  app.notices = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function shownMessages(): string[] {
  return [...document.querySelectorAll('.notice')].map((el) => el.querySelector(':scope > div > span')?.textContent ?? '');
}

describe('Meldungen als Warteschlange', () => {
  it('stapelt mehrere Meldungen und schließt sie einzeln', async () => {
    render(NoticeToast);
    showNotice('Link kopiert');
    showNotice('Speichern fehlgeschlagen', 'error');
    await tick();

    expect(shownMessages()).toEqual(['Link kopiert', 'Speichern fehlgeschlagen']);
    expect(screen.getByRole('alert').textContent).toContain('Aktion fehlgeschlagen');

    await fireEvent.click(screen.getAllByRole('button', { name: 'Meldung schließen' })[0]);
    expect(shownMessages()).toEqual(['Speichern fehlgeschlagen']);
  });

  it('lässt jede Meldung nach ihrer eigenen Zeit verschwinden', async () => {
    render(NoticeToast);
    showNotice('Erste');
    vi.advanceTimersByTime(2000);
    showNotice('Zweite');
    await tick();
    expect(shownMessages()).toEqual(['Erste', 'Zweite']);

    vi.advanceTimersByTime(2300);
    await tick();
    expect(shownMessages()).toEqual(['Zweite']);

    vi.advanceTimersByTime(2000);
    await tick();
    expect(shownMessages()).toEqual([]);
  });

  it('zeigt höchstens vier Meldungen und fasst gleiche zusammen', async () => {
    render(NoticeToast);
    for (const message of ['A', 'B', 'C', 'D', 'E']) showNotice(message);
    showNotice('E');
    await tick();

    expect(shownMessages()).toEqual(['B', 'C', 'D', 'E']);
  });
});
