import type { PanelId } from './workspaces';

const CHANNEL_NAME = 'aublst-ui-sync:v1';
const PRESENCE_INTERVAL_MS = 2000;
const PRESENCE_MAX_AGE_MS = 7000;

type HighlightEntity = 'event' | 'vehicle';

interface WindowPresence {
  sender: string;
  scope: string;
  workspaceId: string;
  panels: PanelId[];
  activeEventId: number | null;
  dispatchVehicleIds: number[];
  hostsCurrentEvent: boolean;
  sentAt: number;
}

type SyncMessage =
  | ({ type: 'presence' } & WindowPresence)
  | { type: 'presence-request'; sender: string; scope: string }
  | { type: 'bye'; sender: string; scope: string }
  | { type: 'open-event'; sender: string; scope: string; eventId: number; target: string; hostAvailable: boolean }
  | { type: 'close-event'; sender: string; scope: string }
  | { type: 'highlight'; sender: string; scope: string; entity: HighlightEntity; id: number | null }
  | { type: 'focus-vehicle'; sender: string; scope: string; vehicleId: number; target: string }
  | { type: 'dispatch-selection'; sender: string; scope: string; eventId: number; vehicleIds: number[] };

export interface UiSyncHandlers {
  onOpenEvent: (eventId: number, hostedHere: boolean) => void;
  onCloseEvent: () => void;
  onHighlight: (entity: HighlightEntity, id: number | null) => void;
  onFocusVehicle: (vehicleId: number) => void;
  onDispatchSelection: (eventId: number, vehicleIds: number[]) => void;
  onSnapshot: (eventId: number, vehicleIds: number[], hostedHere: boolean) => void;
  onCurrentEventHostChange: (remoteHostAvailable: boolean) => void;
}

interface LocalPresence {
  scope: string;
  workspaceId: string;
  panels: PanelId[];
  activeEventId: number | null;
  dispatchVehicleIds: number[];
  hostsCurrentEvent: boolean;
}

const windowId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `window-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | null = null;
let handlers: UiSyncHandlers | null = null;
let presenceTimer: number | null = null;
let localPresence: LocalPresence = {
  scope: '',
  workspaceId: '',
  panels: [],
  activeEventId: null,
  dispatchVehicleIds: [],
  hostsCurrentEvent: false,
};
const peers = new Map<string, WindowPresence>();

function post(message: SyncMessage): void {
  channel?.postMessage(message);
}

function currentPresence(): WindowPresence {
  return { sender: windowId, sentAt: Date.now(), ...localPresence };
}

function announcePresence(): void {
  if (!localPresence.scope) return;
  post({ type: 'presence', ...currentPresence() });
}

function activePeers(): WindowPresence[] {
  const cutoff = Date.now() - PRESENCE_MAX_AGE_MS;
  for (const [id, peer] of peers) {
    if (peer.sentAt < cutoff || peer.scope !== localPresence.scope) peers.delete(id);
  }
  return [...peers.values()].filter((peer) => peer.scope === localPresence.scope);
}

function preferredPeer(panel: PanelId): WindowPresence | undefined {
  return activePeers()
    .filter((peer) => peer.panels.includes(panel))
    .sort((left, right) => right.sentAt - left.sentAt)[0];
}

function notifyPresenceChange(): void {
  handlers?.onCurrentEventHostChange(activePeers().some((peer) => peer.hostsCurrentEvent));
}

function localHasPanel(panel: PanelId): boolean {
  return localPresence.panels.includes(panel);
}

function sameScope(message: { sender: string; scope: string }): boolean {
  return message.sender !== windowId && Boolean(localPresence.scope) && message.scope === localPresence.scope;
}

function onMessage(event: MessageEvent<SyncMessage>): void {
  const message = event.data;
  if (!message || typeof message !== 'object' || !sameScope(message)) return;

  if (message.type === 'presence') {
    peers.set(message.sender, message);
    if (localPresence.activeEventId === null && message.activeEventId !== null) {
      handlers?.onSnapshot(message.activeEventId, message.dispatchVehicleIds, localHasPanel('current_event'));
    }
    notifyPresenceChange();
    return;
  }
  if (message.type === 'presence-request') {
    announcePresence();
    return;
  }
  if (message.type === 'bye') {
    peers.delete(message.sender);
    notifyPresenceChange();
    return;
  }
  if (message.type === 'open-event') {
    const hostedHere = localHasPanel('current_event') || message.target === windowId;
    handlers?.onOpenEvent(message.eventId, hostedHere);
    return;
  }
  if (message.type === 'close-event') {
    handlers?.onCloseEvent();
    return;
  }
  if (message.type === 'highlight') {
    handlers?.onHighlight(message.entity, message.id);
    return;
  }
  if (message.type === 'focus-vehicle') {
    if (message.target === windowId) handlers?.onFocusVehicle(message.vehicleId);
    return;
  }
  if (message.type === 'dispatch-selection') {
    handlers?.onDispatchSelection(message.eventId, message.vehicleIds);
  }
}

function onBeforeUnload(): void {
  if (localPresence.scope) post({ type: 'bye', sender: windowId, scope: localPresence.scope });
}

export function startUiSync(nextHandlers: UiSyncHandlers): () => void {
  handlers = nextHandlers;
  if (typeof BroadcastChannel === 'undefined') return () => { handlers = null; };
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', onMessage);
  window.addEventListener('beforeunload', onBeforeUnload);
  presenceTimer = window.setInterval(() => {
    announcePresence();
    notifyPresenceChange();
  }, PRESENCE_INTERVAL_MS);
  if (localPresence.scope) post({ type: 'presence-request', sender: windowId, scope: localPresence.scope });

  return () => {
    onBeforeUnload();
    if (presenceTimer !== null) window.clearInterval(presenceTimer);
    presenceTimer = null;
    window.removeEventListener('beforeunload', onBeforeUnload);
    channel?.removeEventListener('message', onMessage);
    channel?.close();
    channel = null;
    handlers = null;
    peers.clear();
  };
}

export function updateUiSyncPresence(
  scope: string,
  workspaceId: string,
  panels: PanelId[],
  activeEventId: number | null,
  dispatchVehicleIds: number[],
  hostsCurrentEvent: boolean,
): void {
  const scopeChanged = scope !== localPresence.scope;
  localPresence = {
    scope,
    workspaceId,
    panels: [...panels],
    activeEventId,
    dispatchVehicleIds: [...dispatchVehicleIds],
    hostsCurrentEvent,
  };
  if (scopeChanged) peers.clear();
  announcePresence();
  notifyPresenceChange();
  if (scopeChanged && scope) post({ type: 'presence-request', sender: windowId, scope });
}

export function uiSyncScope(apiBase: string, sessionToken: string): string {
  if (!sessionToken) return '';
  const value = `${apiBase}\0${sessionToken}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `session-${(hash >>> 0).toString(36)}`;
}

export function openEventAcrossWindows(eventId: number): { hostedHere: boolean; hostAvailable: boolean } {
  const peer = preferredPeer('current_event');
  const hostAvailable = localHasPanel('current_event') || Boolean(peer);
  const target = localHasPanel('current_event') ? windowId : peer?.sender ?? windowId;
  if (localPresence.scope) {
    post({ type: 'open-event', sender: windowId, scope: localPresence.scope, eventId, target, hostAvailable });
  }
  return { hostedHere: target === windowId, hostAvailable };
}

export function closeEventAcrossWindows(): void {
  if (localPresence.scope) post({ type: 'close-event', sender: windowId, scope: localPresence.scope });
}

export function highlightAcrossWindows(entity: HighlightEntity, id: number | null): void {
  if (localPresence.scope) post({ type: 'highlight', sender: windowId, scope: localPresence.scope, entity, id });
}

export function focusVehicleAcrossWindows(vehicleId: number): boolean {
  const peer = preferredPeer('map');
  const target = localHasPanel('map') ? windowId : peer?.sender ?? windowId;
  if (localPresence.scope) {
    post({ type: 'focus-vehicle', sender: windowId, scope: localPresence.scope, vehicleId, target });
  }
  return target === windowId;
}

export function dispatchSelectionAcrossWindows(eventId: number, vehicleIds: number[]): void {
  if (!localPresence.scope) return;
  post({
    type: 'dispatch-selection',
    sender: windowId,
    scope: localPresence.scope,
    eventId,
    vehicleIds: [...vehicleIds],
  });
}
