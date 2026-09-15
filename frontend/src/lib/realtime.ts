import { app } from './state.svelte';

export interface RealtimeEvent {
  event: string;
  data: string;
}

export function parseSseChunk(buffer: string, chunk: string): { events: RealtimeEvent[]; remainder: string } {
  const normalized = (buffer + chunk).replaceAll('\r\n', '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const events: RealtimeEvent[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, remainder };
}

interface StreamOptions {
  onChange: () => void;
  onPositions?: () => void;
  onStatus: (connected: boolean) => void;
}

// Der Server schickt mindestens alle 10 Sekunden einen Heartbeat. Kommt
// länger nichts, hängt die Verbindung halboffen: der Browser meldet keinen
// Fehler, es kommen aber auch keine Ereignisse mehr. Dann lieber abbrechen und
// neu aufbauen, sonst gilt der Kanal als verbunden und das Polling bleibt im
// langsamen Takt.
const STREAM_IDLE_TIMEOUT_MS = 25_000;

export function startRealtimeStream({ onChange, onPositions, onStatus }: StreamOptions): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastRevision = -1;
  let lastPositionRevision = -1;

  const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

  async function run(): Promise<void> {
    while (!stopped && app.sessionToken) {
      const request = new AbortController();
      controller = request;
      let connected = false;
      let idleStream = false;
      const giveUpOnIdleStream = () => {
        idleStream = true;
        request.abort();
      };
      let idleTimer = window.setTimeout(giveUpOnIdleStream, STREAM_IDLE_TIMEOUT_MS);
      try {
        const response = await fetch(`${app.apiBase}?action=stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({
            session_token: app.sessionToken,
            last_revision: lastRevision,
            last_position_revision: lastPositionRevision,
          }),
          cache: 'no-store',
          signal: request.signal,
        });
        if (response.status === 400 || response.status === 404) return;
        if (!response.ok || !response.body) throw new Error(`Echtzeitkanal nicht verfügbar (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          // Erst mit dem ersten Paket gilt der Kanal als verbunden - Header
          // allein sagen nichts darüber, ob wirklich etwas durchkommt.
          if (!connected) {
            connected = true;
            onStatus(true);
          }
          clearTimeout(idleTimer);
          idleTimer = window.setTimeout(giveUpOnIdleStream, STREAM_IDLE_TIMEOUT_MS);
          const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
          buffer = parsed.remainder;
          for (const incoming of parsed.events) {
            if (incoming.event === 'positions') {
              try {
                const revision = Number((JSON.parse(incoming.data) as { position_revision?: unknown }).position_revision);
                if (Number.isFinite(revision)) lastPositionRevision = revision;
              } catch {
                // Ein ungültiges Push-Paket darf den Polling-Rückfall nicht stoppen.
              }
              onPositions?.();
              continue;
            }
            if (incoming.event !== 'change') continue;
            try {
              const revision = Number((JSON.parse(incoming.data) as { revision?: unknown }).revision);
              if (Number.isFinite(revision)) lastRevision = revision;
            } catch {
              // Ein ungültiges Push-Paket darf den Polling-Rückfall nicht stoppen.
            }
            onChange();
          }
        }
      } catch (error) {
        if (idleStream) console.debug('Echtzeitkanal ohne Lebenszeichen, wird neu aufgebaut');
        else if (!request.signal.aborted && !stopped) console.debug('Echtzeitkanal getrennt', error);
      } finally {
        clearTimeout(idleTimer);
        onStatus(false);
        controller = null;
      }
      if (!stopped) await wait(1500);
    }
  }

  void run();
  return () => {
    stopped = true;
    controller?.abort();
    onStatus(false);
  };
}
