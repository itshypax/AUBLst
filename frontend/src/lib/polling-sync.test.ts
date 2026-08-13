import { describe, expect, it } from 'vitest';
import { selectPollingLeader } from './polling-sync';

describe('Polling-Koordination', () => {
  it('wählt für alle Fenster dieselbe kleinste Kennung', () => {
    expect(selectPollingLeader('window-c', ['window-b', 'window-a'])).toBe('window-a');
    expect(selectPollingLeader('window-a', ['window-c', 'window-b'])).toBe('window-a');
  });

  it('bleibt ohne weitere Fenster selbst zuständig', () => {
    expect(selectPollingLeader('window-a', [])).toBe('window-a');
  });
});
