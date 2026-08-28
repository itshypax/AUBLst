import { describe, expect, it } from 'vitest';
import { fitMapPoints, focusMapView, toScreen, worldToCanvas, type MapView } from './mapview';

const bounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 500 };
const baseView: MapView = {
  width: 1000,
  height: 500,
  natural: { w: 1000, h: 500 },
  zoom: 1,
  pan: { x: 0, y: 0 },
};

describe('Kartenausschnitt', () => {
  it('zentriert den Einsatz im vergrößerten Kartenausschnitt', () => {
    const event = { x: 750, y: -250 };
    const view = focusMapView(event, bounds, baseView, 2);
    const screenPoint = toScreen(worldToCanvas(event, bounds, view), view);

    expect(view.zoom).toBe(2);
    expect(screenPoint).toEqual({ x: 500, y: 250 });
  });

  it('zeigt am Kartenrand keine Fläche außerhalb des Kartenbilds', () => {
    const view = focusMapView({ x: 0, y: 0 }, bounds, baseView, 2);

    expect(view.pan.x).toBeCloseTo(0);
    expect(view.pan.y).toBeCloseTo(0);
  });

  it('passt mehrere Einsatzstellen gemeinsam in den Kartenausschnitt ein', () => {
    const events = [{ x: 200, y: -100 }, { x: 800, y: -400 }];
    const view = fitMapPoints(events, bounds, baseView);
    const screenPoints = events.map((event) => toScreen(worldToCanvas(event, bounds, view), view));

    expect(screenPoints.every((point) => point.x >= 0 && point.x <= 1000)).toBe(true);
    expect(screenPoints.every((point) => point.y >= 0 && point.y <= 500)).toBe(true);
  });
});
