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
      .sort(
        (a, b) => Number(Boolean(b.event)) - Number(Boolean(a.event)) || a.zone.name.localeCompare(b.zone.name, 'de'),
      );
  });
</script>

<section class="panel">
  <div class="panel-header"><h2>BMAs</h2></div>
  <div class="panel-body table-wrap" aria-live="polite">
    <table aria-label="Brandmeldeanlagen">
      <thead>
        <tr><th>Anlage</th></tr>
      </thead>
      <tbody>
        {#each rows as row (row.zone.id)}
          <tr
            class:active={Boolean(row.event)}
            tabindex={row.event ? 0 : undefined}
            onclick={() => row.event && openAssign(row.event)}
            onkeydown={(event) => {
              if (row.event && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                openAssign(row.event);
              }
            }}
            onmouseenter={() => row.event && setHighlightedEvent(row.event.id)}
            onmouseleave={() => row.event && setHighlightedEvent(null)}
            aria-label={`${row.zone.name}, ${row.event ? 'ausgelöst' : 'ohne Alarm'}`}
          >
            <td><span class="name">{row.zone.name}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !rows.length}
      <div class="empty-hint">Noch keine BMA-Zonen für diese Karte hinterlegt</div>
    {/if}
  </div>
</section>

<style>
  .table-wrap {
    overflow: auto;
    padding: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 12px;
  }
  th {
    padding: 3px 5px;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 500;
    text-align: left;
  }
  td {
    padding: 5px;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 14px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  tbody tr {
    outline: none;
  }
  tbody tr.active {
    cursor: pointer;
    background-color: var(--speech-alert-bg);
    color: var(--speech-alert-text);
    animation: bma-alert 1.2s step-end infinite;
  }
  tbody tr.active td {
    color: var(--speech-alert-text);
  }
  tbody tr.active:hover,
  tbody tr.active:focus-visible {
    background: var(--accent-soft);
  }
  tbody tr.active:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-outline);
  }
  .name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  @keyframes bma-alert {
    0%,
    49% {
      background-color: var(--speech-alert-bg);
    }
    50%,
    100% {
      background-color: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    tbody tr.active {
      animation: none;
    }
  }
</style>
