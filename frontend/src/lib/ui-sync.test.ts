import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  highlightAcrossWindows,
  openEventAcrossWindows,
  startUiSync,
  uiSyncScope,
  updateUiSyncPresence,
  type UiSyncHandlers,
} from './ui-sync';

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

const handlers: UiSyncHandlers = {
  onOpenEvent: vi.fn(),
  onCloseEvent: vi.fn(),
  onHighlight: vi.fn(),
  onFocusVehicle: vi.fn(),
  onDispatchSelection: vi.fn(),
  onSnapshot: vi.fn(),
  onCurrentEventHostChange: vi.fn(),
};

let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  Object.values(handlers).forEach((handler) => vi.mocked(handler).mockClear());
  stop = startUiSync(handlers);
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Fensterübergreifende Arbeitsansichten', () => {
  it('leitet Einsätze an ein Fenster mit aktuellem Einsatz weiter', () => {
    const scope = uiSyncScope('/api.php', 'test-session');
    updateUiSyncPresence(scope, 'einsatzliste', ['events'], null, [], false);
    MockBroadcastChannel.latest.receive({
      type: 'presence',
      sender: 'dispatch-window',
      scope,
      workspaceId: 'disposition',
      panels: ['current_event'],
      activeEventId: null,
      dispatchVehicleIds: [],
      hostsCurrentEvent: false,
      sentAt: Date.now(),
    });

    expect(openEventAcrossWindows(42)).toEqual({ hostedHere: false, hostAvailable: true });
    expect(MockBroadcastChannel.latest.posted).toContainEqual(expect.objectContaining({
      type: 'open-event',
      eventId: 42,
      target: 'dispatch-window',
    }));
  });

  it('übernimmt Hervorhebungen aus einem anderen Fenster', () => {
    const scope = uiSyncScope('/api.php', 'test-session');
    updateUiSyncPresence(scope, 'karte', ['map'], null, [], false);
    MockBroadcastChannel.latest.receive({
      type: 'highlight',
      sender: 'vehicle-window',
      scope,
      entity: 'vehicle',
      id: 17,
    });

    expect(handlers.onHighlight).toHaveBeenCalledWith('vehicle', 17);

    highlightAcrossWindows('vehicle', null);
    expect(MockBroadcastChannel.latest.posted).toContainEqual(expect.objectContaining({
      type: 'highlight',
      entity: 'vehicle',
      id: null,
    }));
  });

  it('überträgt keine Sitzungscodes im Kanalnamen', () => {
    const scope = uiSyncScope('/api.php', 'geheimer-code');
    expect(scope).toMatch(/^session-/);
    expect(scope).not.toContain('geheimer-code');
  });
});
