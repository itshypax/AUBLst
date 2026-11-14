import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminMetrics from './AdminMetrics.svelte';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Messwerte in der Zentrale', () => {
  it('lädt die Tagesaggregate und zeigt sie als Tabelle', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      enabled: true,
      days_back: 30,
      days: [
        { day: '2026-09-05', metrics: { events_created: { count: 3, sum: 3, average: 1, max: 1 }, active_events: { count: 4, sum: 10, average: 2.5, max: 5 }, state_load_ms: { count: 4, sum: 480, average: 120, max: 300 } } },
        { day: '2026-09-04', metrics: { events_created: { count: 1, sum: 1, average: 1, max: 1 } } },
      ],
    }));
    render(AdminMetrics, { key: 'geheim' });

    await screen.findByRole('table');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operator_key: 'geheim' });
    const rows = [...document.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()).join(' '));
    expect(rows[0]).toBe('05.09. 3 2.5 5 120 ms 300 ms 4');
    expect(rows[1]).toBe('04.09. 1 – – – – –');
    expect(document.querySelectorAll('.bars')).toHaveLength(3);
  });

  it('nennt den Grund, wenn keine Messwerte vorliegen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { enabled: false, days_back: 30, days: [] }));
    render(AdminMetrics, { key: 'geheim' });

    await screen.findByText(/keine Messwerte/);
    expect(screen.getByText(/abgeschaltet/)).toBeTruthy();
  });
});
