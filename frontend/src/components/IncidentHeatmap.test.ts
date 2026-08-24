import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import IncidentHeatmap from './IncidentHeatmap.svelte';

describe('Einsatz-Heatmap', () => {
  it('lässt sich über die Kartensteuerung vergrößern und wieder einpassen', async () => {
    const { container } = render(IncidentHeatmap, {
      imageUrl: '/map.png',
      points: [{ x: 50, y: -50 }],
      bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 100 },
    });
    const image = container.querySelector('img');

    await fireEvent.click(screen.getByRole('button', { name: 'Heatmap vergrößern' }));
    expect(image?.style.transform).toContain('scale(1.25)');
    expect((screen.getByRole('button', { name: 'Heatmap einpassen' }) as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Heatmap einpassen' }));
    expect(image?.style.transform).toContain('scale(1)');
    expect((screen.getByRole('button', { name: 'Heatmap einpassen' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
