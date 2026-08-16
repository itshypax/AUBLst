import { worldToCanvas, type MapView, type Point } from './mapview';
import type { MapBounds } from './types';

export function visibleHeatmapPoints(points: Point[], bounds: MapBounds, view: MapView): Point[] {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => worldToCanvas(point, bounds, view))
    .filter((point) => point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height);
}
