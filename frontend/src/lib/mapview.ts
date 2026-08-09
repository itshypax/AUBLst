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
