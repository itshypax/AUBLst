import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import EventsPanel from './EventsPanel.svelte';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('../lib/polling', () => ({ refreshState: vi.fn() }));

beforeEach(() => {
  resetSessionData();
  app.sessionToken = 'demo';
  app.stateHealthy = true;
  app.connected = true;
  app.lastSuccessfulSync = Date.now();
  app.events = [
    {
      id: 1001,
      game_event_id: null,
      name: 'Absicherung Stadtfest',
      x: 100,
      y: -100,
      status: 'active',
      created_by: 'frontend',
    },
    {
      id: 12,
      game_event_id: '12',
      name: 'Unklare Rauchentwicklung',
      x: 200,
      y: -200,
      status: 'active',
      created_by: 'game',
    },
    {
      id: 13,
      game_event_id: '13',
      name: 'Gewässerverunreinigung im Hafen',
      x: 300,
      y: -300,
      status: 'active',
      created_by: 'game',
    },
    {
      id: 14,
      game_event_id: '14',
      name: 'Unklarer Stoffaustritt',
      x: 400,
      y: -400,
      status: 'active',
      created_by: 'game',
    },
  ];
});

afterEach(() => cleanup());

describe('Einsatzübersicht', () => {
  it('kennzeichnet Leitstellen-Einsaetze mit einem Signalmast', () => {
    const { container } = render(EventsPanel);

    const controlRoomIcon = screen.getByLabelText('Leitstellen-Einsatz');
    expect(controlRoomIcon.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('[aria-label="Leitstellen-Einsatz"] svg')).toHaveLength(1);
    expect(screen.getByText(/wird ans Spiel übertragen/)).toBeTruthy();
  });

  it('kennzeichnet Wasserlagen mit dem Wellensymbol', () => {
    render(EventsPanel);

    const waterIcon = screen.getByLabelText('Wassereinsatz');
    expect(waterIcon.querySelector('svg')).not.toBeNull();
  });

  it('kennzeichnet Gefahrgutlagen mit dem Gefahrstoffsymbol', () => {
    render(EventsPanel);

    const hazardIcon = screen.getByLabelText('Gefahrguteinsatz');
    expect(hazardIcon.querySelector('svg')).not.toBeNull();
  });

  it('färbt den linken Balken passend zur Einsatzart', () => {
    render(EventsPanel);

    expect(screen.getByLabelText('Brandeinsatz').closest('.row')?.classList.contains('fire')).toBe(true);
    expect(screen.getByLabelText('Wassereinsatz').closest('.row')?.classList.contains('water')).toBe(true);
    expect(screen.getByLabelText('Gefahrguteinsatz').closest('.row')?.classList.contains('hazard')).toBe(true);
    expect(screen.getByLabelText('Leitstellen-Einsatz').closest('.row')?.classList.contains('control-room')).toBe(true);
  });

  it('zeigt disponierte Einsätze unter Aktuell mit Fahrzeugzahl ohne letzte Funkzeit', async () => {
    app.assignments = [{ event_id: 12, vehicle_id: 7 }];
    app.logs = [{
      id: 1,
      type: 'vehicle',
      entity_id: '7_HLF_1',
      event_id: 12,
      message: 'Status 3',
      long_message: 'Einsatz übernommen',
      state: 'active',
      created_at: '2026-08-16 20:10:00',
      updated_at: '2026-08-16 20:11:00',
    }];
    render(EventsPanel);

    const row = screen.getByText('Unklare Rauchentwicklung').closest('.row');
    expect(row?.textContent).toContain('#12 · 1 Fahrzeug');
    expect(row?.textContent).not.toContain('Funk');
    expect(row?.textContent).not.toContain('20:11');
  });

  it('zeigt abgeschlossene Einsätze nicht in der Live-Liste', () => {
    app.events = [{ ...app.events[1], status: 'completed' }];
    render(EventsPanel);
    expect(screen.queryByText('Unklare Rauchentwicklung')).toBeNull();
  });

  it('kombiniert die Filter für neue und laufende Einsätze', async () => {
    app.assignments = [{ event_id: 12, vehicle_id: 7 }];
    render(EventsPanel);

    const newFilter = screen.getByRole('button', { name: /Neu/ });
    const currentFilter = screen.getByRole('button', { name: /Aktuell/ });

    expect(newFilter.getAttribute('aria-pressed')).toBe('true');
    expect(currentFilter.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Absicherung Stadtfest')).toBeTruthy();
    expect(screen.getByText('Unklare Rauchentwicklung')).toBeTruthy();

    await fireEvent.click(newFilter);
    expect(screen.queryByText('Absicherung Stadtfest')).toBeNull();
    expect(screen.getByText('Unklare Rauchentwicklung')).toBeTruthy();
  });
});
