import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import AlarmMonitorPage from './AlarmMonitorPage.svelte';

const mocks = vi.hoisted(() => ({ switchSession: vi.fn() }));
vi.mock('../lib/polling', () => ({ switchSession: mocks.switchSession }));

beforeEach(() => {
  resetSessionData();
  localStorage.clear();
  history.replaceState(null, '', '/?view=monitor');
  mocks.switchSession.mockReset().mockImplementation(async () => {
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Spieler-Alarmmonitor', () => {
  it('fragt Raumcode und eine der vier Hauptwachen ab', () => {
    render(AlarmMonitorPage);

    expect(screen.getByRole('heading', { name: 'Alarmmonitor öffnen' })).toBeTruthy();
    expect(screen.getByLabelText('Raumcode')).toBeTruthy();
    for (const station of ['1', '2', '3', '4']) {
      expect(screen.getByRole('button', { name: `Wache ${station}` })).toBeTruthy();
    }
  });

  it('verbindet den Monitor ohne PIN und merkt sich die Wache', async () => {
    const user = userEvent.setup();
    render(AlarmMonitorPage);

    await user.type(screen.getByLabelText('Raumcode'), '758c');
    await user.click(screen.getByRole('button', { name: 'Wache 3' }));
    await user.click(screen.getByRole('button', { name: 'Alarmmonitor anzeigen' }));

    expect(mocks.switchSession).toHaveBeenCalledWith(app.apiBase, '758c', '', { readOnly: true });
    expect(new URLSearchParams(location.search).get('wache')).toBe('3');
    expect(localStorage.getItem('alarmMonitorStation')).toBe('3');
  });

  it('zeigt nur Alarmierungen und Fahrzeuge der gewählten Wache', () => {
    history.replaceState(null, '', '/?view=monitor&wache=1');
    app.sessionToken = '758c';
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
    app.vehicles = [
      {
        id: 1,
        game_vehicle_id: '1_HLF_1',
        name: '1-HLF-1',
        type: 'HLF',
        modes: null,
        x: 10,
        y: -20,
        status: 4,
        assigned_player_id: null,
      },
      {
        id: 2,
        game_vehicle_id: '2_HLF_1',
        name: '2-HLF-1',
        type: 'HLF',
        modes: null,
        x: 20,
        y: -30,
        status: 2,
        assigned_player_id: null,
      },
    ];
    app.events = [
      {
        id: 10,
        game_event_id: '47',
        name: 'Wohnungsbrand',
        x: 100,
        y: -200,
        status: 'active',
        created_by: 'game',
        created_at: '2026-08-28 18:00:00',
      },
    ];
    app.assignments = [{ event_id: 10, vehicle_id: 1, alarm_modes: ['Sondersignal'] }];

    render(AlarmMonitorPage);

    expect(screen.getByText(/^AUBLst \| /)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Wohnungsbrand' })).toBeTruthy();
    expect(screen.getByText('Einsatz 47')).toBeTruthy();
    expect(screen.getAllByText('1-HLF-1').length).toBeGreaterThan(0);
    expect(screen.queryByText('2-HLF-1')).toBeNull();
  });

  it('ordnet die Alarmton-Einstellungen als beschriftete Schalter an', async () => {
    history.replaceState(null, '', '/?view=monitor&wache=1');
    app.sessionToken = '758c';
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
    const user = userEvent.setup();

    render(AlarmMonitorPage);
    await user.click(screen.getByText('Alarmton'));

    expect(screen.getByText('Tonausgabe')).toBeTruthy();
    expect(screen.getByLabelText('Gong abspielen')).toBeTruthy();
    expect(screen.getByLabelText('Fahrzeugansage abspielen')).toBeTruthy();
    expect(screen.getByLabelText('Lautstärke')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hörprobe abspielen' })).toBeTruthy();
  });

  it('zeigt mitalarmierte Fahrzeuge anderer Wachen nur beim Einsatz', () => {
    history.replaceState(null, '', '/?view=monitor&wache=1');
    app.sessionToken = '758c';
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
    app.vehicles = [
      {
        id: 1,
        game_vehicle_id: '1_HLF_1',
        name: '1-HLF-1',
        type: 'HLF',
        modes: null,
        x: 10,
        y: -20,
        status: 4,
        assigned_player_id: null,
      },
      {
        id: 2,
        game_vehicle_id: '2_DLK_1',
        name: '2-DLK-1',
        type: 'DLK',
        modes: null,
        x: 20,
        y: -30,
        status: 3,
        assigned_player_id: null,
      },
      {
        id: 3,
        game_vehicle_id: 'TD',
        name: 'Stadtwerke',
        type: 'TD',
        modes: null,
        x: -1000000,
        y: -1000000,
        status: 4,
        assigned_player_id: null,
      },
    ];
    app.events = [
      {
        id: 10,
        game_event_id: '47',
        name: 'Wohnungsbrand',
        x: 100,
        y: -200,
        status: 'active',
        created_by: 'game',
        created_at: '2026-08-28 18:00:00',
      },
    ];
    app.assignments = app.vehicles.map((vehicle) => ({
      event_id: 10,
      vehicle_id: vehicle.id,
      alarm_modes: vehicle.id === 2 ? ['Mit Angriffstrupp'] : [],
    }));

    const { container } = render(AlarmMonitorPage);

    expect(screen.getByRole('heading', { name: 'Weitere alarmierte Kräfte' })).toBeTruthy();
    expect(screen.getByText('2-DLK-1')).toBeTruthy();
    const additionalUnit = screen.getByText('2-DLK-1').closest('.dispatch-unit');
    expect(additionalUnit?.classList.contains('with-subtext')).toBe(true);
    expect(additionalUnit?.querySelector('.unit-status')?.textContent).toBe('3');
    expect(screen.queryByText('Stadtwerke')).toBeNull();
    expect(container.querySelector('.vehicle-board')?.textContent).not.toContain('2-DLK-1');
  });

  it('rendert alle Fahrzeuge der Wache in der Vollbildübersicht', () => {
    history.replaceState(null, '', '/?view=monitor&wache=2');
    app.sessionToken = 'fe79';
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
    app.vehicles = Array.from({ length: 18 }, (_, index) => ({
      id: index + 1,
      game_vehicle_id: `2_FAHRZEUG_${index + 1}`,
      name: `Florian Auenburg 2-${index + 1}`,
      type: index % 2 === 0 ? 'HLF' : 'RTW',
      modes: null,
      x: index * 10,
      y: index * -10,
      status: index % 9,
      assigned_player_id: null,
    }));

    const { container } = render(AlarmMonitorPage);

    for (let index = 1; index <= 18; index += 1) {
      expect(screen.getByText(`Florian Auenburg 2-${index}`)).toBeTruthy();
    }
    expect(container.querySelector('.status-block.status-0')?.textContent).toBe('C');
    expect(container.querySelector('.vehicle-row:has(.status-block.status-0)')?.classList.contains('status-c-alert')).toBe(
      true,
    );
    expect(container.querySelector('.vehicle-row:has(.status-block.status-1) .status-text')?.textContent).toBe(
      'Einsatzbereit Funk',
    );
  });

  it('zeigt einen neuen Alarm zuerst groß und wechselt danach in die Einsatzwand', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/?view=monitor&wache=1');
    app.sessionToken = 'fe79';
    app.stateHealthy = true;
    app.lastSuccessfulSync = Date.now();
    app.vehicles = [1, 2, 3].map((id) => ({
      id,
      game_vehicle_id: `1_HLF_${id}`,
      name: `Florian Auenburg 1-HLF-${id}`,
      type: 'HLF',
      modes: null,
      x: id * 10,
      y: id * -10,
      status: 4,
      assigned_player_id: null,
    }));
    app.vehicles.push({
      id: 4,
      game_vehicle_id: '2_DLK_1',
      name: 'Florian Auenburg 2-DLK-1',
      type: 'DLK',
      modes: null,
      x: 40,
      y: -40,
      status: 3,
      assigned_player_id: null,
    });
    app.events = [1, 2, 3].map((id) => ({
      id,
      game_event_id: String(id),
      name: `Einsatz ${id}`,
      x: id * 100,
      y: id * -100,
      status: 'active' as const,
      created_by: 'game' as const,
      created_at: `2026-08-28 18:0${id}:00`,
    }));
    app.assignments = [1, 2, 3].map((id) => ({ event_id: id, vehicle_id: id }));
    app.assignments.push({ event_id: 1, vehicle_id: 4 });

    const { container } = render(AlarmMonitorPage);
    await tick();
    expect(screen.getByRole('heading', { name: 'Einsatz 3' })).toBeTruthy();
    expect(screen.getByText('Neue Alarmierung')).toBeTruthy();

    vi.advanceTimersByTime(15_000);
    await tick();

    expect(container.querySelectorAll('.wall-event')).toHaveLength(3);
    expect(container.querySelector('.incident-wall')?.classList.contains('three')).toBe(true);
    expect(container.querySelector('.wall-label')).toBeNull();
    expect(container.querySelector('.vehicle-assignment')).toBeNull();
    expect(container.querySelector('[style*="--incident-color"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Einsatz 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Einsatz 2' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Einsatz 3' })).toBeTruthy();
    const firstEvent = Array.from(container.querySelectorAll<HTMLElement>('.wall-event')).find((event) =>
      event.textContent?.includes('Einsatz 1'),
    );
    expect(firstEvent?.querySelector('.wall-group-label')?.textContent).toBe('Weitere alarmierte Kräfte');
    expect(firstEvent?.textContent).toContain('Florian Auenburg 2-DLK-1');
    expect(firstEvent?.querySelector('.status-3')?.textContent).toBe('3');
  });
});
