import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLog from './AdminLog.svelte';

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

describe('Adapter-Log in der Zentrale', () => {
  it('zeigt das Log je Sitzung und filtert nach Level', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      limit: 5000,
      entries: [
        { id: 2, session_id: 7, created_at: '2026-11-14 10:00:05', level: 'bad', text: 'Logdatei ~/Spiele/logfile.txt fehlt' },
        { id: 1, session_id: 7, created_at: '2026-11-14 10:00:00', level: 'good', text: 'Code erhalten' },
      ],
    }));
    render(AdminLog, { key: 'geheim' });

    await screen.findByText('Sitzung 7');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operator_key: 'geheim' });
    expect(document.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText(/1 mit Warnung oder Fehler/)).toBeTruthy();

    await fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'bad' } });
    expect([...document.querySelectorAll('li .text')].map((cell) => cell.textContent)).toEqual(['Logdatei ~/Spiele/logfile.txt fehlt']);
    await fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'warn' } });
    expect(screen.getByText('Keine Einträge mit diesem Level.')).toBeTruthy();
  });
});
