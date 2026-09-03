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
  onStatus: (connected: boolean) => void;
}

export function startRealtimeStream({ onChange, onStatus }: StreamOptions): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let lastRevision = -1;

  const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

  async function run(): Promise<void> {
    while (!stopped && app.sessionToken) {
      controller = new AbortController();
      try {
        const v2 = app.apiMode === 'v2';
        const url = v2
          ? `${app.apiV2Base}/sessions/${encodeURIComponent(app.sessionId)}/stream?lastRevision=${lastRevision}`
          : `${app.apiBase}?action=stream`;
        const headers: Record<string, string> = v2
          ? { Accept: 'text/event-stream', 'X-Session-Code': app.sessionToken }
          : { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
        if (v2 && app.pin) headers['X-Session-Pin'] = app.pin;
        const response = await fetch(url, {
          method: v2 ? 'GET' : 'POST',
          headers,
          body: v2 ? undefined : JSON.stringify({ session_token: app.sessionToken, last_revision: lastRevision }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 400 || response.status === 404) return;
        if (!response.ok || !response.body) throw new Error(`Echtzeitkanal nicht verfügbar (${response.status})`);
        onStatus(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }));
          buffer = parsed.remainder;
          for (const incoming of parsed.events) {
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
        if (!controller.signal.aborted && !stopped) console.debug('Echtzeitkanal getrennt', error);
      } finally {
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
