import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATOR_KEY_STORAGE } from '../lib/operator';
import OperatorPage from './OperatorPage.svelte';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Betreiberansicht', () => {
  it('fragt ohne gemerkten Schlüssel zuerst den Schlüssel ab', () => {
    render(OperatorPage);

    expect(screen.getByLabelText('Betreiber-Schlüssel')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lädt mit Schlüssel die Tagesaggregate und zeigt sie als Tabelle', async () => {
    sessionStorage.setItem(OPERATOR_KEY_STORAGE, 'geheim');
    fetchMock.mockResolvedValue(jsonResponse(200, {
      enabled: true,
      days_back: 30,
      days: [
        { day: '2026-09-05', metrics: { events_created: { count: 3, sum: 3, average: 1, max: 1 }, active_events: { count: 4, sum: 10, average: 2.5, max: 5 }, state_load_ms: { count: 4, sum: 480, average: 120, max: 300 } } },
        { day: '2026-09-04', metrics: { events_created: { count: 1, sum: 1, average: 1, max: 1 } } },
      ],
    }));
    render(OperatorPage);

    await screen.findByRole('table');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operator_key: 'geheim' });
    const rows = [...document.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()).join(' '));
    expect(rows[0]).toBe('05.09. 3 2.5 5 120 ms 300 ms 4');
    expect(rows[1]).toBe('04.09. 1 – – – – –');
    expect(document.querySelectorAll('.bars')).toHaveLength(3);
    expect(screen.queryByLabelText('Betreiber-Schlüssel')).toBeNull();
  });

  it('verwirft einen abgelehnten Schlüssel und zeigt die Fehlermeldung', async () => {
    sessionStorage.setItem(OPERATOR_KEY_STORAGE, 'falsch');
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Der Betreiber-Schlüssel stimmt nicht.' }));
    render(OperatorPage);

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('stimmt nicht');
    expect(screen.getByLabelText('Betreiber-Schlüssel')).toBeTruthy();
    expect(sessionStorage.getItem(OPERATOR_KEY_STORAGE)).toBeNull();
  });

  it('merkt sich einen eingegebenen Schlüssel nach erfolgreichem Abruf', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { enabled: true, days_back: 30, days: [] }));
    render(OperatorPage);

    await fireEvent.input(screen.getByLabelText('Betreiber-Schlüssel'), { target: { value: 'geheim' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Anzeigen' }));

    await screen.findByText(/keine Messwerte/);
    expect(sessionStorage.getItem(OPERATOR_KEY_STORAGE)).toBe('geheim');
  });
});
