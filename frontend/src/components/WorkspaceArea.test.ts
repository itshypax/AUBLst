import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionData } from '../lib/state.svelte';
import WorkspaceArea from './WorkspaceArea.svelte';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('../lib/polling', () => ({ dismissLog: vi.fn(), refreshState: vi.fn() }));

beforeEach(() => resetSessionData());
afterEach(() => cleanup());

describe('Größenregler innerhalb einer Arbeitsfläche', () => {
  it('setzt zwischen drei Modulen zwei verstellbare Trennlinien', async () => {
    const onRatiosChange = vi.fn();
    render(WorkspaceArea, {
      props: {
        panels: ['events', 'logs', 'hospitals'],
        direction: 'column',
        ratios: [0.4, 0.35, 0.25],
        onRatiosChange,
      },
    });

    const separators = screen.getAllByRole('slider');
    expect(separators).toHaveLength(2);

    await fireEvent.keyDown(separators[0], { key: 'ArrowDown' });
    expect(onRatiosChange).toHaveBeenCalledOnce();
    expect(onRatiosChange.mock.calls[0][0]).toHaveLength(3);
  });
});
