import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import SessionGate from './SessionGate.svelte';

const mocks = vi.hoisted(() => ({ switchSession: vi.fn(), createDemoSession: vi.fn() }));
vi.mock('../lib/polling', () => ({ switchSession: mocks.switchSession }));
vi.mock('../lib/demo-session', () => ({ createDemoSession: mocks.createDemoSession }));

beforeEach(() => {
  resetSessionData();
  app.sessionToken = '';
  app.pin = '';
  mocks.switchSession.mockReset().mockResolvedValue(undefined);
  mocks.createDemoSession.mockReset().mockResolvedValue({ token: 'demo', pin: '4321' });
});

afterEach(() => cleanup());

describe('Session-Einstieg', () => {
  it('zeigt ohne Sitzung direkt die Verbindungseingabe', () => {
    render(SessionGate);

    expect(screen.getByRole('dialog', { name: 'Mit der Leitstelle verbinden' })).toBeTruthy();
    expect(screen.getByLabelText('Sitzungscode')).toBeTruthy();
    expect(screen.getByLabelText(/PIN/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alarmmonitor für Spieler' }).getAttribute('href')).toContain(
      'view=monitor',
    );
  });

  it('übergibt Sitzungscode und PIN erst beim Verbinden', async () => {
    const user = userEvent.setup();
    render(SessionGate);

    await user.type(screen.getByLabelText('Sitzungscode'), '758c');
    await user.type(screen.getByLabelText(/PIN/), '1234');
    await user.click(screen.getByRole('button', { name: 'Verbinden' }));

    expect(mocks.switchSession).toHaveBeenCalledWith(app.apiBase, '758c', '1234');
  });

  it('zeigt einen vorab erhaltenen Code als wartend an', () => {
    app.sessionToken = '758c';
    app.lastError = 'Session not found. Initialize with action=sync first.';
    render(SessionGate);

    expect(screen.getByText('Warte auf Spielstart')).toBeTruthy();
    expect(screen.queryByText(/action=sync/)).toBeNull();
  });

  it('legt vom Einstieg aus eine Demo-Sitzung an', async () => {
    const user = userEvent.setup();
    render(SessionGate);

    await user.click(screen.getByRole('button', { name: 'Demo-Sitzung anlegen' }));

    expect(mocks.createDemoSession).toHaveBeenCalledWith(app.apiBase);
    expect(mocks.switchSession).toHaveBeenCalledWith(app.apiBase, 'demo', '4321');
  });
});
