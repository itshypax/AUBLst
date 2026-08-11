import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import SessionOverviewModal from './SessionOverviewModal.svelte';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../lib/api', () => ({ api: mocks.api }));

beforeEach(() => {
  resetSessionData();
  app.sessionOverviewOpen = true;
  mocks.api.mockImplementation((action: string) => {
    if (action === 'events_archive') return Promise.resolve({ events: [] });
    if (action === 'session_statistics') return Promise.resolve({
      session: { token: 'demo', created_at: '2026-08-11 12:00:00', generated_at: '2026-08-11 13:00:00' },
      events: [],
      dispatches: [],
      status_history: [],
      log_count: 0,
    });
    return Promise.resolve({});
  });
});

afterEach(() => cleanup());

describe('Sitzungsübersicht', () => {
  it('wechselt im selben Fenster zwischen Einsatzakte und Statistik', async () => {
    const user = userEvent.setup();
    render(SessionOverviewModal);

    const records = document.getElementById('overview-records')!;
    const statistics = document.getElementById('overview-statistics')!;
    expect(records.hidden).toBe(false);
    expect(statistics.hidden).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'Statistik' }));

    expect(records.hidden).toBe(true);
    expect(statistics.hidden).toBe(false);
    expect(screen.getByRole('tab', { name: 'Statistik' }).getAttribute('aria-selected')).toBe('true');
  });

  it('schließt beide Ansichten gemeinsam', async () => {
    const user = userEvent.setup();
    render(SessionOverviewModal);

    await user.click(screen.getByRole('button', { name: 'Schließen' }));

    expect(app.sessionOverviewOpen).toBe(false);
  });
});
