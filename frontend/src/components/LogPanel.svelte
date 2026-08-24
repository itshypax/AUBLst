<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, FolderOpen } from '../lib/fontawesome-icons';
  import { vehicleDisplayNameForIdentifier } from '../lib/classify';
  import { dismissLog } from '../lib/polling';
  import { isSpeechRequest } from '../lib/speech-requests';
  import { app, canWrite, eventById, openAssign, setHighlightedEvent } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { LogRow, VehicleStatusChange } from '../lib/types';
  import StatusBadge from './StatusBadge.svelte';

  type FmsRow = { kind: 'log'; key: string; timestamp: string; row: LogRow } | { kind: 'status'; key: string; timestamp: string; row: VehicleStatusChange };
  const rows = $derived([
    ...app.logs.map((row): FmsRow => ({ kind: 'log', key: `log-${row.id}`, timestamp: row.updated_at, row })),
    ...app.statusHistory.map((row): FmsRow => ({ kind: 'status', key: `status-${row.id}`, timestamp: row.created_at, row })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
  let dismissing = $state<Set<number>>(new Set());

  function timeOf(row: LogRow): string {
    return row.updated_at?.slice(11, 16) ?? '';
  }

  function statusTime(row: VehicleStatusChange): string {
    return row.created_at?.slice(11, 16) ?? '';
  }

  function entityName(row: LogRow): string {
    return vehicleDisplayNameForIdentifier(row.entity_id, app.vehicles);
  }

  function openEvent(row: LogRow): void {
    if (row.event_id == null) return;
    const event = eventById(Number(row.event_id));
    if (event) openAssign(event);
  }

  async function dismiss(id: number): Promise<void> {
    if (dismissing.has(id)) return;
    dismissing = new Set(dismissing).add(id);
    try {
      await dismissLog(id);
    } catch (error) {
      app.lastError = (error as Error).message;
    } finally {
      const next = new Set(dismissing);
      next.delete(id);
      dismissing = next;
    }
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h2>FMS-LOG</h2>
  </div>
  <div class="panel-body log" role="list" aria-live="polite">
    {#each rows as item (item.key)}
      {#if item.kind === 'status'}
        <div class="row status-change" role="listitem">
          <span class="time" data-tooltip={item.row.created_at}>{statusTime(item.row)}</span>
          <span class="entity">{item.row.vehicle_name || item.row.game_vehicle_id}</span>
          <StatusBadge value={Number(item.row.status)} />
        </div>
      {:else}
      {@const row = item.row}
      {@const speechRequest = isSpeechRequest(row)}
      <div
        class="row"
        class:fresh={app.lastLogBatch.includes(row.id)}
        class:done={row.state === 'inactive'}
        onmouseenter={() => row.event_id != null && setHighlightedEvent(Number(row.event_id))}
        onmouseleave={() => row.event_id != null && setHighlightedEvent(null)}
        role="listitem"
      >
        <span class="time" data-tooltip={row.updated_at}>{timeOf(row)}</span>
        {#if row.entity_id}
          <span class="entity">{entityName(row)}</span>
        {/if}
        <span class="message">{decodeEntities(row.long_message)}</span>
        {#if row.state === 'inactive'}
          <span class="done-mark" data-tooltip="Abgearbeitet" aria-label="Abgearbeitet"><FaIcon icon={Check} size={13} /></span>
        {:else if !speechRequest && row.event_id != null}
          <button class="ghost" data-tooltip="Einsatz öffnen" aria-label="Einsatz öffnen" onclick={() => openEvent(row)}>
            <FaIcon icon={FolderOpen} size={13} />
          </button>
          <button class="ghost" data-tooltip="Abarbeiten" aria-label="Meldung abarbeiten" disabled={dismissing.has(row.id) || !canWrite()} onclick={() => void dismiss(row.id)}>
            <FaIcon icon={Check} size={13} />
          </button>
        {/if}
      </div>
      {/if}
    {/each}
    {#if !rows.length}
      <div class="empty-hint">Keine FMS-Einträge</div>
    {/if}
  </div>
</section>

<style>
  .log {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px;
    padding: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    border-left: 2px solid transparent;
  }

  .row:hover {
    background: var(--accent-soft);
  }

  .row.fresh {
    border-left-color: var(--accent);
    background: rgba(76, 141, 255, 0.07);
  }

  .row.done {
    opacity: 0.45;
  }

  .time {
    color: var(--text-dim);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }

  .entity {
    color: var(--accent-outline);
    font-weight: 600;
    flex: 0 0 auto;
  }

  .message {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status-change { min-height: 28px; }

  .done-mark {
    color: var(--good);
    flex: 0 0 auto;
    display: inline-flex;
  }

  .row button {
    flex: 0 0 auto;
    opacity: 0;
  }

  .row:hover button,
  .row:focus-within button {
    opacity: 1;
  }

</style>
