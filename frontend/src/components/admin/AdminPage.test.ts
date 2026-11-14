import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPERATOR_KEY_STORAGE } from '../../lib/admin';
import AdminPage from './AdminPage.svelte';

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function actionOf(call: unknown[]): string {
  return new URL(String(call[0]), 'http://localhost').searchParams.get('action') ?? '';
}

beforeEach(() => {
  sessionStorage.clear();
  location.hash = '';
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('metrics_summary')
        ? jsonResponse(200, { enabled: true, days_back: 30, days: [] })
        : jsonResponse(200, { mods: [] }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Zentrale', () => {
  it('fragt ohne gemerkten Schlüssel zuerst den Schlüssel ab', () => {
    render(AdminPage);

    expect(screen.getByLabelText('Betreiber-Schlüssel')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prüft den gemerkten Schlüssel und zeigt die Mods', async () => {
    sessionStorage.setItem(OPERATOR_KEY_STORAGE, 'geheim');
    render(AdminPage);

    await screen.findByRole('table');
    expect(actionOf(fetchMock.mock.calls[0])).toBe('admin_mods');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ operator_key: 'geheim' });
    expect(screen.queryByLabelText('Betreiber-Schlüssel')).toBeNull();
  });

  it('verwirft einen abgelehnten Schlüssel und zeigt die Fehlermeldung', async () => {
    sessionStorage.setItem(OPERATOR_KEY_STORAGE, 'falsch');
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Der Betreiber-Schlüssel stimmt nicht.' }));
    render(AdminPage);

    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('stimmt nicht');
    expect(screen.getByLabelText('Betreiber-Schlüssel')).toBeTruthy();
    expect(sessionStorage.getItem(OPERATOR_KEY_STORAGE)).toBeNull();
  });

  it('merkt sich einen eingegebenen Schlüssel nach erfolgreicher Prüfung', async () => {
    render(AdminPage);

    await fireEvent.input(screen.getByLabelText('Betreiber-Schlüssel'), { target: { value: 'geheim' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    await screen.findByRole('table');
    expect(sessionStorage.getItem(OPERATOR_KEY_STORAGE)).toBe('geheim');
  });

  it('wechselt den Bereich und merkt ihn im Hash', async () => {
    sessionStorage.setItem(OPERATOR_KEY_STORAGE, 'geheim');
    render(AdminPage);
    await screen.findByRole('table');

    await fireEvent.click(screen.getByRole('button', { name: 'Messwerte' }));

    await screen.findByText(/keine Messwerte/);
    expect(location.hash).toBe('#metrics');
    expect(fetchMock.mock.calls.map(actionOf)).toContain('metrics_summary');
  });
});
