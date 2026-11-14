import type { AdapterView } from './types';

// Der Adapter meldet sich alle fünf Sekunden; drei verpasste Meldungen gelten als offline.
export const ADAPTER_OFFLINE_AFTER_MS = 15_000;

export interface AdapterIndicator {
  kind: 'ok' | 'warn' | 'error';
  text: string;
  title: string;
}

const clock = (ms: number, seconds = false) =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });

/** Ob ein Befehl gerade im Spiel ankommen kann. Null bei Adaptern, die nichts melden. */
export function adapterIndicator(adapter: AdapterView | null, nowMs: number): AdapterIndicator | null {
  if (!adapter) return null;
  const ageMs = Math.max(0, nowMs - adapter.seenAt);
  if (ageMs > ADAPTER_OFFLINE_AFTER_MS) {
    return { kind: 'error', text: `Adapter offline seit ${clock(adapter.seenAt)}`, title: `Letzte Meldung um ${clock(adapter.seenAt, true)}` };
  }
  const title = `Adapter ${adapter.version || 'ohne Version'}, zuletzt gemeldet vor ${Math.round(ageMs / 1000)} s`;
  if (!adapter.game) return { kind: 'warn', text: 'Spiel nicht gestartet', title };
  if (!adapter.round) return { kind: 'warn', text: 'Wartet auf Rundenstart', title };
  return { kind: 'ok', text: 'Spiel läuft', title };
}
