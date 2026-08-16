import type { LogCursor } from './log-stream';
import type { LogRow, StateResponse } from './types';

const CHANNEL_NAME = 'aublst-polling-sync:v1';
const HEARTBEAT_INTERVAL_MS = 2_000;
const PEER_MAX_AGE_MS = 7_000;

export interface PollingSnapshot {
  state: StateResponse | null;
  logs: LogRow[];
  logCursor: LogCursor;
  stateHealthy: boolean;
  logsHealthy: boolean;
  lastSuccessfulSync: number | null;
  lastSuccessfulLogPoll: number | null;
  lastError: string;
  logError: string;
}

interface PollingHandlers {
  onLeaderChange: (leader: boolean) => void;
  onState: (state: StateResponse, receivedAt: number) => void;
  onLogs: (rows: LogRow[], cursor: LogCursor, receivedAt: number) => void;
  onLogAcknowledged: (id: number, updatedAt: string) => void;
  onLogDismissed: (id: number, updatedAt: string) => void;
  onSnapshot: (snapshot: PollingSnapshot) => void;
  snapshot: () => PollingSnapshot;
}

type PollingMessage =
  | { type: 'heartbeat'; sender: string; scope: string; sentAt: number }
  | { type: 'bye'; sender: string; scope: string }
  | { type: 'snapshot-request'; sender: string; scope: string }
  | { type: 'snapshot'; sender: string; scope: string; target: string; snapshot: PollingSnapshot }
  | { type: 'state'; sender: string; scope: string; state: StateResponse; receivedAt: number }
  | { type: 'logs'; sender: string; scope: string; rows: LogRow[]; cursor: LogCursor; receivedAt: number }
  | { type: 'log-acknowledged'; sender: string; scope: string; id: number; updatedAt: string }
  | { type: 'log-dismissed'; sender: string; scope: string; id: number; updatedAt: string };

const windowId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null = null;
let heartbeatTimer: number | null = null;
let scope = '';
let leader = true;
let handlers: PollingHandlers | null = null;
const peers = new Map<string, number>();

export function selectPollingLeader(ownId: string, peerIds: string[]): string {
  return [ownId, ...peerIds].sort((left, right) => left.localeCompare(right))[0];
}

function post(message: PollingMessage): void {
  channel?.postMessage(message);
}

function activePeerIds(): string[] {
  const cutoff = Date.now() - PEER_MAX_AGE_MS;
  for (const [id, sentAt] of peers) {
    if (sentAt < cutoff) peers.delete(id);
  }
  return [...peers.keys()];
}

function updateLeadership(): void {
  const next = channel === null || selectPollingLeader(windowId, activePeerIds()) === windowId;
  if (next === leader) return;
  leader = next;
  handlers?.onLeaderChange(leader);
  if (!leader) requestPollingSnapshot();
}

function announce(): void {
  if (!scope) return;
  post({ type: 'heartbeat', sender: windowId, scope, sentAt: Date.now() });
  updateLeadership();
}

function onMessage(event: MessageEvent<PollingMessage>): void {
  const message = event.data;
  if (!message || typeof message !== 'object' || message.sender === windowId || message.scope !== scope) return;

  if (message.type === 'heartbeat') {
    peers.set(message.sender, message.sentAt);
    updateLeadership();
    return;
  }
  if (message.type === 'bye') {
    peers.delete(message.sender);
    updateLeadership();
    return;
  }
  if (message.type === 'snapshot-request') {
    if (leader && handlers) {
      post({ type: 'snapshot', sender: windowId, scope, target: message.sender, snapshot: handlers.snapshot() });
    }
    return;
  }
  if (message.type === 'log-dismissed') {
    handlers?.onLogDismissed(message.id, message.updatedAt);
    return;
  }
  if (message.type === 'log-acknowledged') {
    handlers?.onLogAcknowledged(message.id, message.updatedAt);
    return;
  }
  if (leader) return;
  if (message.type === 'snapshot' && (message.target === windowId || message.target === '*')) {
    handlers?.onSnapshot(message.snapshot);
  } else if (message.type === 'state') {
    handlers?.onState(message.state, message.receivedAt);
  } else if (message.type === 'logs') {
    handlers?.onLogs(message.rows, message.cursor, message.receivedAt);
  }
}

function onBeforeUnload(): void {
  if (scope) post({ type: 'bye', sender: windowId, scope });
}

export function startPollingSync(nextHandlers: PollingHandlers): () => void {
  handlers = nextHandlers;
  if (typeof BroadcastChannel === 'undefined') {
    leader = true;
    return () => {
      handlers = null;
    };
  }

  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', onBeforeUnload);
  heartbeatTimer = window.setInterval(announce, HEARTBEAT_INTERVAL_MS);
  announce();

  return () => {
    onBeforeUnload();
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    window.removeEventListener('beforeunload', onBeforeUnload);
    channel?.removeEventListener('message', onMessage);
    channel?.close();
    channel = null;
    handlers = null;
    peers.clear();
    leader = true;
  };
}

export function setPollingScope(nextScope: string): void {
  if (nextScope === scope) return;
  if (scope) post({ type: 'bye', sender: windowId, scope });
  scope = nextScope;
  peers.clear();
  const wasLeader = leader;
  leader = true;
  announce();
  if (!wasLeader) handlers?.onLeaderChange(true);
  requestPollingSnapshot();
}

export function isPollingLeader(): boolean {
  return leader;
}

export function requestPollingSnapshot(): void {
  if (!channel || !scope || leader) return;
  post({ type: 'snapshot-request', sender: windowId, scope });
}

export function broadcastPollingState(state: StateResponse, receivedAt: number): void {
  if (!channel || !scope || !leader) return;
  post({ type: 'state', sender: windowId, scope, state, receivedAt });
}

export function broadcastPollingLogs(rows: LogRow[], cursor: LogCursor, receivedAt: number): void {
  if (!channel || !scope || !leader || !rows.length) return;
  post({ type: 'logs', sender: windowId, scope, rows, cursor, receivedAt });
}

export function broadcastLogDismissed(id: number, updatedAt: string): void {
  if (!channel || !scope) return;
  post({ type: 'log-dismissed', sender: windowId, scope, id, updatedAt });
}

export function broadcastLogAcknowledged(id: number, updatedAt: string): void {
  if (!channel || !scope) return;
  post({ type: 'log-acknowledged', sender: windowId, scope, id, updatedAt });
}

export function broadcastPollingSnapshot(): void {
  if (!channel || !scope || !leader || !handlers) return;
  post({ type: 'snapshot', sender: windowId, scope, target: '*', snapshot: handlers.snapshot() });
}
