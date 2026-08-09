<script lang="ts">
  import { Check, FolderOpen, Hospital, Radio } from 'lucide-svelte';
  import { isHospitalTransportUnit } from '../lib/classify';
  import { dismissLog, isSpeechRequest } from '../lib/polling';
  import { app, canWrite, eventById, openAssign, setHighlightedEvent } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import type { LogRow, Vehicle } from '../lib/types';

  const rows = $derived([...app.logs].reverse());
  let dismissing = $state<Set<number>>(new Set());

  function timeOf(row: LogRow): string {
    return row.updated_at?.slice(11, 16) ?? '';
  }

  function openEvent(row: LogRow): void {
    if (row.event_id == null) return;
    const ev = eventById(Number(row.event_id));
    if (ev) openAssign(ev);
  }

  function normalized(value: string | null | undefined): string {
    return (value ?? '').toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]/g, '');
  }

  function appearsAsIdentifier(message: string, identifier: string): boolean {
    const parts = identifier
      .toLocaleLowerCase('de')
      .split(/[^a-z0-9äöüß]+/)
      .filter(Boolean);
    if (!parts.length) return false;
    const pattern = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z0-9äöüß]*');
    return new RegExp(`(^|[^a-z0-9äöüß])${pattern}($|[^a-z0-9äöüß])`, 'i').test(message);
  }

  function speechRequestVehicle(row: LogRow): Vehicle | undefined {
    if (row.state === 'inactive' || !isSpeechRequest(row)) return undefined;
    const entity = normalized(row.entity_id);
    const transportUnits = app.vehicles.filter(isHospitalTransportUnit);

    if (entity) {
      const exact = transportUnits.find((vehicle) =>
        [vehicle.game_vehicle_id, vehicle.name].some((identifier) => normalized(identifier) === entity),
      );
      if (exact) return exact;
    }

    const message = `${row.message} ${row.long_message}`;
    return transportUnits.find((vehicle) =>
      [vehicle.game_vehicle_id, vehicle.name]
        .filter((identifier): identifier is string => Boolean(identifier))
        .some((identifier) => appearsAsIdentifier(message, identifier)),
    );
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
    <span class="icon"><Radio size={14} /></span>
    <h2>Funkmeldungen</h2>
  </div>
  <div class="panel-body log" role="list" aria-live="polite">
    {#each rows as row (row.id)}
      {@const speechVehicle = speechRequestVehicle(row)}
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
          <span class="entity">{row.entity_id}</span>
        {/if}
        <span class="message">{decodeEntities(row.long_message)}</span>
        {#if row.state === 'inactive'}
          <span class="done-mark" data-tooltip="Abgearbeitet" aria-label="Abgearbeitet"><Check size={13} /></span>
        {:else}
          {#if speechVehicle}
            <button class="ghost hospital-action" data-tooltip={`Klinik für ${speechVehicle.name || speechVehicle.game_vehicle_id} zuweisen`} aria-label={`Klinik für ${speechVehicle.name || speechVehicle.game_vehicle_id} zuweisen`} disabled={!canWrite()} onclick={() => (app.hospitalAssignmentVehicleId = speechVehicle.id)}>
              <Hospital size={13} />
            </button>
          {/if}
          {#if row.event_id != null}
            <button class="ghost" data-tooltip="Einsatz öffnen" aria-label="Einsatz öffnen" onclick={() => openEvent(row)}>
              <FolderOpen size={13} />
            </button>
            <button class="ghost" data-tooltip="Abarbeiten" aria-label="Meldung abarbeiten" disabled={dismissing.has(row.id) || !canWrite()} onclick={() => void dismiss(row.id)}>
              <Check size={13} />
            </button>
          {/if}
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

  .row button.hospital-action {
    color: var(--accent);
  }
</style>
