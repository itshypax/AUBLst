import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastLogDismissed,
  selectPollingLeader,
  setPollingScope,
  startPollingSync,
} from './polling-sync';

class MockBroadcastChannel {
  static latest: MockBroadcastChannel;
  posted: unknown[] = [];
  listeners = new Set<(event: MessageEvent) => void>();

  constructor(_name: string) {
    MockBroadcastChannel.latest = this;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(_type: string, listener: EventListener): void {
    this.listeners.add(listener as (event: MessageEvent) => void);
  }

  removeEventListener(_type: string, listener: EventListener): void {
    this.listeners.delete(listener as (event: MessageEvent) => void);
  }

  close(): void {}

  receive(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Polling-Koordination', () => {
  it('wählt für alle Fenster dieselbe kleinste Kennung', () => {
    expect(selectPollingLeader('window-c', ['window-b', 'window-a'])).toBe('window-a');
    expect(selectPollingLeader('window-a', ['window-c', 'window-b'])).toBe('window-a');
  });

  it('bleibt ohne weitere Fenster selbst zuständig', () => {
    expect(selectPollingLeader('window-a', [])).toBe('window-a');
  });

  it('verteilt erledigte Logeinträge an alle Fenster derselben Sitzung', () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    const onLogDismissed = vi.fn();
    const scope = 'session-sprechwunsch-test';
    const stop = startPollingSync({
      onLeaderChange: vi.fn(),
      onState: vi.fn(),
      onLogs: vi.fn(),
      onLogDismissed,
      onSnapshot: vi.fn(),
      snapshot: vi.fn(),
    });
    setPollingScope(scope);

    broadcastLogDismissed(21, '2026-08-15 20:10:00.123456');
    expect(MockBroadcastChannel.latest.posted).toContainEqual(expect.objectContaining({
      type: 'log-dismissed',
      scope,
      id: 21,
      updatedAt: '2026-08-15 20:10:00.123456',
    }));

    MockBroadcastChannel.latest.receive({
      type: 'log-dismissed',
      sender: 'anderes-fenster',
      scope,
      id: 34,
      updatedAt: '2026-08-15 20:11:00.654321',
    });
    expect(onLogDismissed).toHaveBeenCalledWith(34, '2026-08-15 20:11:00.654321');

    stop();
  });
});
