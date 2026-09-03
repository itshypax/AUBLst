import { describe, expect, it } from 'vitest';
import { canvasToWorld, fitMapPoints, focusMapView, screenPointInMapContent, toScreen, worldToCanvas, type MapView } from './mapview';

const bounds = { min_x: 0, min_y: 0, max_x: 1000, max_y: 500 };
const baseView: MapView = {
  width: 1000,
  height: 500,
  natural: { w: 1000, h: 500 },
  zoom: 1,
  pan: { x: 0, y: 0 },
};

describe('Kartenausschnitt', () => {
  it('projiziert die Spielwelt in den inneren Bereich einer gerahmten Karte', () => {
    const framedView: MapView = {
      width: 2152,
      height: 2200,
      natural: { w: 2152, h: 2200 },
      contentRect: { x: 52, y: 100, width: 2048, height: 2048 },
      zoom: 1,
      pan: { x: 0, y: 0 },
    };
    const framedBounds = { min_x: 0, min_y: 0, max_x: 2048, max_y: 2048 };

    expect(worldToCanvas({ x: 0, y: 0 }, framedBounds, framedView)).toEqual({ x: 52, y: 100 });
    expect(worldToCanvas({ x: 2048, y: -2048 }, framedBounds, framedView)).toEqual({ x: 2100, y: 2148 });
    expect(canvasToWorld({ x: 1076, y: 1124 }, framedBounds, framedView)).toEqual({ x: 1024, y: -1024 });
    expect(screenPointInMapContent({ x: 20, y: 500 }, framedView)).toBe(false);
    expect(screenPointInMapContent({ x: 52, y: 100 }, framedView)).toBe(true);
  });

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
