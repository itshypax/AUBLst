import { describe, expect, it } from 'vitest';
import { visibleHeatmapPoints } from './heatmap';

describe('Einsatz-Heatmap', () => {
  it('ordnet Spielkoordinaten dem tatsächlichen Kartenausschnitt zu', () => {
    const points = visibleHeatmapPoints(
      [
        { x: 50, y: -50 },
        { x: 150, y: -50 },
      ],
      { min_x: 0, min_y: 0, max_x: 100, max_y: 100 },
      { width: 400, height: 200, natural: { w: 1000, h: 500 }, zoom: 1, pan: { x: 0, y: 0 } },
    );
    expect(points).toEqual([{ x: 200, y: 100 }]);
  });
});
