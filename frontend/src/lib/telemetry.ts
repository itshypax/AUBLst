import { app } from './state.svelte';

const REPORT_INTERVAL_MS = 60_000;
let lastReportAt = 0;

export function recordAnonymousMetrics(stateLoadMs: number, activeEvents: number): void {
  const now = Date.now();
  if (!app.sessionToken || now - lastReportAt < REPORT_INTERVAL_MS) return;
  lastReportAt = now;
  void fetch(`${app.apiBase}?action=metrics_record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
