import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, resetSessionData } from '../lib/state.svelte';
import { recordingContext } from '../test/canvas';
import MapPanel from './MapPanel.svelte';

const contexts = new WeakMap<HTMLCanvasElement, ReturnType<typeof recordingContext>>();

function contextFor(canvas: HTMLCanvasElement) {
  let entry = contexts.get(canvas);
  if (!entry) {
    entry = recordingContext();
    contexts.set(canvas, entry);
  }
  return entry;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function vehicle(id: number) {
  return { id, game_vehicle_id: `1_HLF_${id}`, name: `1-HLF-${id}`, type: 'HLF', modes: null, x: 100 * id, y: -100 * id, status: 2, assigned_player_id: null };
}

beforeEach(() => {
  resetSessionData();
  app.stateHealthy = true;
  app.lastSuccessfulSync = Date.now();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return contextFor(this).ctx as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Karte in Ebenen', () => {
  it('zeichnet bei neuen Fahrzeugdaten nur die Markerebene neu', async () => {
    const { container } = render(MapPanel);
    await tick();
    await nextFrame();
    await nextFrame();

    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBe(2);
    const base = contextFor(canvases[0]);
    const markers = contextFor(canvases[1]);
    const baseCallsBefore = base.calls.length;
    const markerCallsBefore = markers.calls.length;

    app.vehicles = [vehicle(1), vehicle(2)];
    await tick();
    await nextFrame();
    await nextFrame();

    expect(base.calls.length).toBe(baseCallsBefore);
    expect(markers.calls.length).toBeGreaterThan(markerCallsBefore);
  });

  it('zeichnet beide Ebenen neu, wenn sich die Kartengrenzen ändern', async () => {
    const { container } = render(MapPanel);
    await tick();
    await nextFrame();
    await nextFrame();

    const canvases = container.querySelectorAll('canvas');
    const base = contextFor(canvases[0]);
    const markers = contextFor(canvases[1]);
    const baseCallsBefore = base.calls.length;
    const markerCallsBefore = markers.calls.length;

    app.mapBounds = { min_x: -500, min_y: -500, max_x: 500, max_y: 500 };
    await tick();
    await nextFrame();
    await nextFrame();

    expect(base.calls.length).toBeGreaterThan(baseCallsBefore);
    expect(markers.calls.length).toBeGreaterThan(markerCallsBefore);
  });
});
