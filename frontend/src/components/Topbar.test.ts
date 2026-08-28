import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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
  getDefaultSoundProfile: () => 'standard',
  getSoundProfileOptions: () => [{ id: 'standard', label: 'Standard' }],
  loadSoundManifest: vi.fn(async () => [
    { id: 'standard', label: 'Standard' },
    { id: 'jannik', label: 'Stimme Jannik' },
  ]),
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
  app.sessionToken = '';
  app.pin = '';
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

  it('bietet die Soundprofile im Sitzungsmenü an', async () => {
    render(Topbar, { props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Sitzung einrichten' }));

    const profile = await screen.findByRole('combobox', { name: 'Soundprofil' });
    expect(profile).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Standard' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Stimme Jannik' })).toBeTruthy();
  });

  it('öffnet den Spieler-Alarmmonitor aus den Sitzungseinstellungen', async () => {
    app.sessionToken = '758c';
    render(Topbar, { props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Sitzung 758c' }));

    expect(screen.getByRole('button', { name: 'Alarmmonitor öffnen' })).toBeTruthy();
  });

  it('bleibt bei Klicks auf inaktive Flächen im Sitzungsmenü geöffnet', async () => {
    const { container } = render(Topbar, {
      props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' },
    });

    const trigger = screen.getByRole('button', { name: 'Sitzung einrichten' });
    await fireEvent.click(trigger);
    await fireEvent.pointerDown(screen.getByText('Darstellung'));
    await fireEvent.click(screen.getByText('Darstellung'));

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#session-settings-popover')).not.toBeNull();
  });

  it('legt den Farbmodus mit Sonne und Mond in die Sitzungseinstellungen', async () => {
    const { container } = render(Topbar, {
      props: { onResetLayout: vi.fn(), onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Sitzung einrichten' }));

    expect(screen.getByRole('button', { name: 'Darkmode' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Lightmode' }).querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.topbar > .theme-toggle')).toBeNull();
  });

  it('setzt das vollständige Layout aus den Sitzungseinstellungen zurück', async () => {
    const onResetLayout = vi.fn();
    render(Topbar, { props: { onResetLayout, onOpenWorkspaceEditor: vi.fn(), workspaceName: 'Standard' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Sitzung einrichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Layout auf Standard zurücksetzen' }));

    expect(onResetLayout).toHaveBeenCalledOnce();
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
