import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import type { LogRow } from '../lib/types';
import Topbar from './Topbar.svelte';

vi.mock('../lib/polling', () => ({
  pollLogs: vi.fn(),
  refreshState: vi.fn(),
  switchSession: vi.fn(),
}));

vi.mock('../lib/sounds', () => ({
  configureSounds: vi.fn(),
  testSound: vi.fn(async () => true),
}));

function globalState(id: number, message: string, longMessage: string): LogRow {
  return {
    id,
    type: 'global',
    entity_id: null,
    event_id: null,
    message,
    long_message: longMessage,
    state: 'active',
    updated_at: '2026-08-10 15:42:00',
  };
}

beforeEach(() => {
  resetSessionData();
  app.logs = [
    globalState(1, 'shortage', 'Rettungsmittelknappheit'),
    globalState(2, 'alarm', 'Alarmstufe'),
    globalState(3, 'doctor', 'Notarztalarm'),
    globalState(4, 'weather', 'Unwetterwarnung'),
  ];
});

afterEach(() => cleanup());

describe('Kopfzeile', () => {
  it('fasst Einsatzakte und Statistik in einem Einstieg zusammen', () => {
    render(Topbar, { props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    expect(screen.getByRole('button', { name: 'Sitzungsübersicht öffnen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Einsatzakte öffnen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Session-Statistik öffnen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tastaturkürzel öffnen' })).toBeTruthy();
  });

  it('zeigt alle aktiven Lagehinweise', () => {
    render(Topbar, { props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    expect(screen.getByText('Rettungsmittelknappheit')).toBeTruthy();
    expect(screen.getByText('Alarmstufe')).toBeTruthy();
    expect(screen.getByText('Notarztalarm')).toBeTruthy();
    expect(screen.getByText('Unwetterwarnung')).toBeTruthy();
    expect(screen.queryByText('+1')).toBeNull();
  });

  it('färbt die Lagehinweise nach ihrer Art', () => {
    render(Topbar, { props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    expect(screen.getByText('Rettungsmittelknappheit').classList.contains('shortage')).toBe(true);
    expect(screen.getByText('Alarmstufe').classList.contains('alarm-level')).toBe(true);
    expect(screen.getByText('Notarztalarm').classList.contains('doctor-alarm')).toBe(true);
    expect(screen.getByText('Unwetterwarnung').classList.contains('default')).toBe(true);
  });
});
