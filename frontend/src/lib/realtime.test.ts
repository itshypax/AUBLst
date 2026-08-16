import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './realtime';

describe('SSE parser', () => {
  it('verarbeitet geteilte Pakete und Kommentare', () => {
    const first = parseSseChunk('', 'retry: 1500\n\nevent: change\ndata: {"revi');
    expect(first.events).toEqual([]);
    const second = parseSseChunk(first.remainder, 'sion":7}\n\n: heartbeat\n\n');
    expect(second.events).toEqual([{ event: 'change', data: '{"revision":7}' }]);
    expect(second.remainder).toBe('');
  });
});
