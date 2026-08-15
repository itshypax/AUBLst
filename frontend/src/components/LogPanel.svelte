<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, FolderOpen, Radio } from '../lib/fontawesome-icons';
  import { vehicleDisplayNameForIdentifier } from '../lib/classify';
  import { dismissLog } from '../lib/polling';
  import { isSpeechRequest } from '../lib/speech-requests';
  import { app, canWrite, eventById, openAssign, setHighlightedEvent } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { LogRow } from '../lib/types';

  const rows = $derived([...app.logs].reverse());
  let dismissing = $state<Set<number>>(new Set());

  function timeOf(row: LogRow): string {
    return row.updated_at?.slice(11, 16) ?? '';
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
    <span class="icon"><FaIcon icon={Radio} size={14} /></span>
    <h2>Funkmeldungen</h2>
  </div>
  <div class="panel-body log" role="list" aria-live="polite">
    {#each rows as row (row.id)}
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
    {/each}
    {#if !rows.length}
      <div class="empty-hint">Keine Funkmeldungen</div>
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
