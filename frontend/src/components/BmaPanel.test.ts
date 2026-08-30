import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import BmaPanel from './BmaPanel.svelte';

beforeEach(() => {
  resetSessionData();
  app.routing = {
    coordinate_space: 'world',
    meters_per_world_unit: 1,
    grid_size_m: 50,
    nodes: [],
    edges: [],
    bma_zones: [
      {
        id: 'rathaus',
        name: 'Rathaus',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
      },
      {
        id: 'kino',
        name: 'Cinemax',
        points: [
          { x: 100, y: 100 },
          { x: 120, y: 100 },
          { x: 120, y: 120 },
          { x: 100, y: 120 },
        ],
      },
    ],
  };
  app.events = [
    {
      id: 1030,
      game_event_id: '30',
      name: 'BMA Rathaus',
      x: 10,
      y: 10,
      status: 'active',
      created_by: 'game',
    },
  ];
});

afterEach(cleanup);

describe('BMA-Tabelle', () => {
  it('zeigt die Anlagen als Tabelle ohne Bereitschaftstext', () => {
    render(BmaPanel);

    expect(screen.getByRole('table', { name: 'Brandmeldeanlagen' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Anlage' })).toBeTruthy();
    expect(screen.getByText('Rathaus')).toBeTruthy();
    expect(screen.getByText('Cinemax')).toBeTruthy();
    expect(screen.queryByText('Bereit')).toBeNull();
    expect(screen.getByText('Rathaus').closest('tr')?.classList.contains('active')).toBe(true);
    expect(screen.getByText('Cinemax').closest('tr')?.classList.contains('active')).toBe(false);
  });

  it('öffnet nur eine ausgelöste BMA', async () => {
    render(BmaPanel);

    await fireEvent.click(screen.getByText('Cinemax'));
    expect(app.assignEvent).toBeNull();

    await fireEvent.click(screen.getByText('Rathaus'));
    expect(app.assignEvent?.id).toBe(1030);
  });
});
