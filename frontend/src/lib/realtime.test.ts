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

import { afterEach, vi } from 'vitest';
import { app } from './state.svelte';
import { startRealtimeStream } from './realtime';

function fakeStream(text: string) {
  const chunks = [new TextEncoder().encode(text)];
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          const value = chunks.shift();
          return value ? { done: false, value } : { done: true, value: undefined };
        },
      }),
    },
  };
}

describe('Echtzeitkanal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('baut einen Kanal neu auf, der keine Lebenszeichen mehr sendet', async () => {
    vi.useFakeTimers();
    app.sessionToken = 'demo';
    // Ein Paket kommt an, danach bleibt die Verbindung stumm offen.
    const silent = (signal: AbortSignal) => {
      let sent = false;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              if (sent)
                return new Promise<never>((_, reject) =>
                  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
                );
              sent = true;
              return Promise.resolve({ done: false, value: new TextEncoder().encode('retry: 1500\n\n') });
            },
          }),
        },
      };
    };
    const fetchMock = vi.fn().mockImplementation((_url, init) => Promise.resolve(silent(init.signal)));
    vi.stubGlobal('fetch', fetchMock);
    const onStatus = vi.fn();

    const stop = startRealtimeStream({ onChange: () => {}, onStatus });
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(24_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onStatus).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('meldet Positionsereignisse getrennt und schickt die Positionsrevision beim Neuaufbau mit', async () => {
    vi.useFakeTimers();
    app.sessionToken = 'demo';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeStream('retry: 1500\n\nevent: positions\ndata: {"position_revision":5}\n\n'))
      .mockResolvedValue(fakeStream(''));
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    const onPositions = vi.fn();

    const stop = startRealtimeStream({ onChange, onPositions, onStatus: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    stop();

    expect(onPositions).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ last_revision: -1, last_position_revision: -1 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ last_position_revision: 5 });
  });
});
