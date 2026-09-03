import { app } from './state.svelte';

const REPORT_INTERVAL_MS = 60_000;
let lastReportAt = 0;

export function recordAnonymousMetrics(stateLoadMs: number, activeEvents: number): void {
  const now = Date.now();
  if (!app.sessionToken || now - lastReportAt < REPORT_INTERVAL_MS) return;
  lastReportAt = now;
  const v2 = app.apiMode === 'v2';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (v2) headers['X-Session-Code'] = app.sessionToken;
  void fetch(v2 ? `${app.apiV2Base}/sessions/${encodeURIComponent(app.sessionId)}/metrics` : `${app.apiBase}?action=metrics_record`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_token: app.sessionToken,
      metrics: {
        state_load_ms: Math.round(Math.max(0, stateLoadMs)),
        active_events: Math.max(0, activeEvents),
      },
    }),
    cache: 'no-store',
  }).catch(() => undefined);
}
