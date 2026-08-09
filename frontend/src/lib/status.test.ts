import { describe, expect, it } from 'vitest';
import { statusDisplay } from './status';

describe('Statusanzeige', () => {
  it('zeigt den internen Status 0 als C an', () => {
    expect(statusDisplay(0)).toBe('C');
    expect(statusDisplay('0')).toBe('C');
    expect(statusDisplay(2)).toBe('2');
  });
});
