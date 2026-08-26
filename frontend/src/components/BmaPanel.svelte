<script lang="ts">
  import { bmaZonesForEvent } from '../lib/bma';
  import { app, openAssign, setHighlightedEvent } from '../lib/state.svelte';

  const rows = $derived.by(() => {
    const zones = app.routing.bma_zones ?? [];
    const eventsByZone = new Map<string, (typeof app.events)[number]>();
    for (const event of app.events) {
      for (const zone of bmaZonesForEvent(zones, event, app.routing)) {
        if (!eventsByZone.has(zone.id)) eventsByZone.set(zone.id, event);
      }
    }
    return zones
      .map((zone) => ({ zone, event: eventsByZone.get(zone.id) }))
      .sort((a, b) => Number(Boolean(b.event)) - Number(Boolean(a.event)) || a.zone.name.localeCompare(b.zone.name, 'de'));
  });
</script>

<section class="panel">
  <div class="panel-header"><h2>BMAs</h2></div>
  <div class="panel-body bma-list" role="list" aria-live="polite">
    {#each rows as row (row.zone.id)}
      <div role="listitem">
        <button
          class="bma-row"
          class:active={Boolean(row.event)}
          disabled={!row.event}
          onclick={() => row.event && openAssign(row.event)}
          onmouseenter={() => row.event && setHighlightedEvent(row.event.id)}
          onmouseleave={() => row.event && setHighlightedEvent(null)}
        >
          <span class="signal" aria-hidden="true"></span>
          <span class="name">{row.zone.name}</span>
          <span class="state">{row.event ? 'Ausgelöst' : 'Bereit'}</span>
        </button>
      </div>
    {/each}
    {#if !rows.length}
      <div class="empty-hint">Noch keine BMA-Zonen für diese Karte hinterlegt</div>
    {/if}
  </div>
</section>

<style>
  .bma-list { padding: 5px; }
  .bma-row { width: 100%; display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 34px; padding: 6px 8px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text); text-align: left; }
  .bma-row:disabled { opacity: 1; cursor: default; }
  [role='listitem'] + [role='listitem'] .bma-row { border-top-color: var(--border); border-top-left-radius: 0; border-top-right-radius: 0; }
  .signal { width: 7px; height: 7px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 2px color-mix(in srgb, var(--good) 18%, transparent); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .state { color: var(--text-dim); font-size: 11px; }
  .bma-row.active { border-color: var(--danger); background-color: color-mix(in srgb, var(--danger) 15%, transparent); cursor: pointer; animation: bma-alert 1.2s step-end infinite; }
  .bma-row.active .signal { background: var(--danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 28%, transparent); }
  .bma-row.active .state { color: var(--danger-text); font-weight: 700; }
  @keyframes bma-alert {
    0%, 49% { background-color: color-mix(in srgb, var(--danger) 15%, transparent); }
    50%, 100% { background-color: transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .bma-row.active { animation: none; } }
</style>
