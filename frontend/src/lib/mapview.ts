import type { MapBounds } from './types';

export interface MapView {
  zoom: number;
  pan: { x: number; y: number };
  natural: { w: number; h: number };
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// Kartenbild wird wie object-fit: contain in die Fläche gelegt
export function imageDrawRect(view: MapView): { x: number; y: number; w: number; h: number } {
  const cw = view.width;
  const ch = view.height;
  const iw = view.natural.w || cw;
  const ih = view.natural.h || ch;
  const cr = cw / ch;
  const ir = iw / ih;
  if (ir > cr) {
    const w = cw;
    const h = cw / ir;
    return { x: 0, y: (ch - h) / 2, w, h };
  }
  const h = ch;
  const w = ch * ir;
  return { x: (cw - w) / 2, y: 0, w, h };
}

// Spielwelt nutzt eine gespiegelte Y-Achse
export function worldToCanvas(pt: Point, bounds: MapBounds, view: MapView): Point {
  const nx = (pt.x - bounds.min_x) / (bounds.max_x - bounds.min_x || 1);
  const ny = (-pt.y - bounds.min_y) / (bounds.max_y - bounds.min_y || 1);
  const d = imageDrawRect(view);
  return { x: d.x + nx * d.w, y: d.y + ny * d.h };
}

export function canvasToWorld(pos: Point, bounds: MapBounds, view: MapView): Point {
  const sceneX = (pos.x - view.pan.x) / view.zoom;
  const sceneY = (pos.y - view.pan.y) / view.zoom;
  const d = imageDrawRect(view);
  const nx = (sceneX - d.x) / d.w;
  const ny = (sceneY - d.y) / d.h;
  const worldX = bounds.min_x + nx * (bounds.max_x - bounds.min_x);
  const worldY = bounds.min_y + ny * (bounds.max_y - bounds.min_y);
  return { x: worldX, y: -worldY };
}

export function toScreen(p: Point, view: MapView): Point {
  return { x: p.x * view.zoom + view.pan.x, y: p.y * view.zoom + view.pan.y };
}

function focusedPan(desired: number, contentStart: number, contentSize: number, viewportSize: number, zoom: number): number {
  const scaledSize = contentSize * zoom;
  if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2 - contentStart * zoom;
  const minimum = viewportSize - (contentStart + contentSize) * zoom;
  const maximum = -contentStart * zoom;
  return Math.min(maximum, Math.max(minimum, desired));
}

export function focusMapView(point: Point, bounds: MapBounds, view: MapView, targetZoom = 2.4): MapView {
  const zoom = Math.max(1, targetZoom);
  const scenePoint = worldToCanvas(point, bounds, view);
  const drawRect = imageDrawRect(view);
  const desiredX = view.width / 2 - scenePoint.x * zoom;
  const desiredY = view.height / 2 - scenePoint.y * zoom;
  return {
    ...view,
    zoom,
    pan: {
      x: focusedPan(desiredX, drawRect.x, drawRect.w, view.width, zoom),
      y: focusedPan(desiredY, drawRect.y, drawRect.h, view.height, zoom),
    },
  };
}

export function fitMapPoints(points: Point[], bounds: MapBounds, view: MapView, maximumZoom = 2.4): MapView {
  if (points.length === 0) return view;
  if (points.length === 1) return focusMapView(points[0], bounds, view, maximumZoom);

  const scenePoints = points.map((point) => worldToCanvas(point, bounds, view));
  const xs = scenePoints.map((point) => point.x);
  const ys = scenePoints.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  const horizontalSpan = Math.max(100, maximumX - minimumX);
  const verticalSpan = Math.max(100, maximumY - minimumY);
  const zoom = Math.max(1, Math.min(maximumZoom, (view.width - 100) / horizontalSpan, (view.height - 100) / verticalSpan));
  const center = { x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2 };
  const drawRect = imageDrawRect(view);
  return {
    ...view,
    zoom,
    pan: {
      x: focusedPan(view.width / 2 - center.x * zoom, drawRect.x, drawRect.w, view.width, zoom),
      y: focusedPan(view.height / 2 - center.y * zoom, drawRect.y, drawRect.h, view.height, zoom),
    },
  };
}
