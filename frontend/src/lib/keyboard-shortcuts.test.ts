import { describe, expect, it } from 'vitest';
import { shortcutActionForEvent } from './keyboard-shortcuts';

function keydown(key: string, target: HTMLElement = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('Tastaturkürzel', () => {
  it('öffnet die Hilfe mit F1 auch in einem Eingabefeld', () => {
    expect(shortcutActionForEvent(keydown('F1', document.createElement('input')))).toBe('toggle-help');
  });

  it('ignoriert Buchstabenkürzel beim Schreiben', () => {
    expect(shortcutActionForEvent(keydown('f', document.createElement('input')))).toBeNull();
  });

  it('ordnet Leitstellenaktionen zu', () => {
    expect(shortcutActionForEvent(keydown('f'))).toBe('focus-vehicle-search');
    expect(shortcutActionForEvent(keydown('M'))).toBe('fit-map');
    expect(shortcutActionForEvent(keydown('2'))).toBe('workspace-2');
  });
});
