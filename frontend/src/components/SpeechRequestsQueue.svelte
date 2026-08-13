<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, FolderOpen, Hospital, RadioTower, X } from '../lib/fontawesome-icons';
  import { isHiddenUnit, isHospitalTransportUnit } from '../lib/classify';
  import { dismissLog } from '../lib/polling';
  import { buildSpeechRequestEntries, type SpeechRequestEntry } from '../lib/speech-requests';
  import { app, canWrite, openAssign } from '../lib/state.svelte';
  import { decodeEntities } from '../lib/text';
  import EmptyState from './EmptyState.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let now = $state(Date.now());
  let dismissing = $state<Set<string>>(new Set());
  let panel: HTMLElement;

  const entries = $derived(buildSpeechRequestEntries(app.logs, app.vehicles, app.events, app.assignments));
  const connectionLost = $derived(Boolean(app.lastSuccessfulSync && !app.stateHealthy));

  $effect(() => {
    const timer = window.setInterval(() => (now = Date.now()), 30_000);
    requestAnimationFrame(() => panel?.focus());
    return () => window.clearInterval(timer);
  });

  function timestamp(value: string): number {
    const parsed = new Date(value.replace(' ', 'T')).getTime();
    return Number.isFinite(parsed) ? parsed : now;
  }

  function ageMinutes(entry: SpeechRequestEntry): number {
    return Math.max(0, Math.floor((now - timestamp(entry.requestedAt)) / 60_000));
  }

  function ageText(entry: SpeechRequestEntry): string {
    const minutes = ageMinutes(entry);
    if (minutes < 1) return 'jetzt';
    if (minutes < 60) return `${minutes} Min.`;
    return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  }

  function vehicleName(entry: SpeechRequestEntry): string {
    return entry.vehicle?.name || entry.vehicle?.game_vehicle_id || entry.row.entity_id || 'Unbekanntes Fahrzeug';
  }

  function openEvent(entry: SpeechRequestEntry): void {
    if (!entry.event) return;
    openAssign(entry.event);
    app.speechQueueOpen = false;
  }

  function openHospital(entry: SpeechRequestEntry): void {
    if (!entry.vehicle) return;
    app.hospitalAssignmentVehicleId = entry.vehicle.id;
    app.speechQueueOpen = false;
  }

  async function dismiss(entry: SpeechRequestEntry): Promise<void> {
    if (dismissing.has(entry.key)) return;
    dismissing = new Set(dismissing).add(entry.key);
    try {
      await Promise.all(entry.rows.map((row) => dismissLog(row.id)));
    } catch (error) {
      app.lastError = (error as Error).message;
    } finally {
      const next = new Set(dismissing);
      next.delete(entry.key);
      dismissing = next;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') app.speechQueueOpen = false;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<aside bind:this={panel} class="speech-queue" class:below-banner={connectionLost} aria-label="Offene Sprechwünsche" tabindex="-1">
  <div class="queue-head">
    <FaIcon icon={RadioTower} size={16} />
    <div>
      <strong>Sprechwünsche</strong>
      <span>{entries.length ? `${entries.length} offen · ältester ${ageText(entries[0])}` : 'Keine offenen Sprechwünsche'}</span>
    </div>
    <button class="ghost close" data-tooltip="Schließen" aria-label="Sprechwünsche schließen" onclick={() => (app.speechQueueOpen = false)}><FaIcon icon={X} size={15} /></button>
  </div>

  <div class="queue-list" aria-live="polite">
    {#each entries as entry (entry.key)}
      {@const minutes = ageMinutes(entry)}
      <article class="request" class:old={minutes >= 5} class:waiting={minutes >= 2 && minutes < 5}>
        <span class="wait">{ageText(entry)}</span>
        <div class="request-main">
          <div class="request-name">
            {#if entry.vehicle && !isHiddenUnit(entry.vehicle)}<StatusBadge value={entry.vehicle.status} />{/if}
            <strong>{vehicleName(entry)}</strong>
          </div>
          <span class="message">{decodeEntities(entry.row.long_message)}</span>
          <span class="event-name">{entry.event ? `${entry.event.name || 'Einsatz'} · Einsatz ${entry.event.id}` : 'Ohne Einsatzbezug'}</span>
        </div>
        <div class="request-actions" aria-label={`Aktionen für ${vehicleName(entry)}`}>
          {#if entry.vehicle && isHospitalTransportUnit(entry.vehicle)}
            <button data-tooltip="Klinik zuweisen" aria-label={`Klinik für ${vehicleName(entry)} zuweisen`} disabled={!canWrite()} onclick={() => openHospital(entry)}><FaIcon icon={Hospital} size={13} /><span>Klinik</span></button>
          {/if}
          {#if entry.event}
            <button data-tooltip="Einsatz öffnen" aria-label={`Einsatz ${entry.event.name || entry.event.id} öffnen`} onclick={() => openEvent(entry)}><FaIcon icon={FolderOpen} size={13} /><span>Einsatz</span></button>
          {/if}
          <button class="done" data-tooltip="Sprechwunsch abarbeiten" aria-label={`Sprechwunsch von ${vehicleName(entry)} abarbeiten`} disabled={dismissing.has(entry.key) || !canWrite()} onclick={() => void dismiss(entry)}><FaIcon icon={Check} size={14} /></button>
        </div>
      </article>
    {/each}
    {#if !entries.length}<EmptyState title="Keine offenen Sprechwünsche" description="Neue Sprechwünsche werden hier nach Eingangszeit sortiert angezeigt." />{/if}
  </div>

</aside>

<style>
  .speech-queue { position: fixed; z-index: 25; top: 52px; right: 8px; width: min(500px, calc(100vw - 16px)); max-height: calc(100vh - 60px); display: flex; flex-direction: column; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); outline: none; }
  .speech-queue.below-banner { top: 86px; max-height: calc(100vh - 94px); }
  .queue-head { display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-bottom: 1px solid var(--border); }
  .queue-head > :global(svg) { color: var(--text-dim); }
  .queue-head div { display: flex; flex-direction: column; min-width: 0; }
  .queue-head strong { font-size: 14px; }
  .queue-head span { color: var(--text-dim); font-size: 12px; }
  .close { margin-left: auto; }
  .queue-list { min-height: 0; overflow: auto; padding: 5px; }
  .request { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 6px 10px; align-items: start; padding: 10px 8px; border-bottom: 1px solid var(--border); border-left: 3px solid transparent; }
  .request.old { border-left-color: var(--danger); background: rgba(232, 82, 74, .055); }
  .request.waiting { border-left-color: var(--warn); }
  .wait { color: var(--text-dim); font: 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
  .old .wait { color: var(--danger-text); }
  .request-main { display: flex; flex-direction: column; min-width: 0; }
  .request-name { display: flex; align-items: center; gap: 7px; }
  .request-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .message { margin-top: 2px; color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }
  .event-name { margin-top: 6px; color: var(--accent-outline); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .request-actions { grid-column: 2; display: flex; gap: 4px; }
  .request-actions button { min-height: 27px; padding: 4px 7px; font-size: 11px; }
  .request-actions .done { color: var(--good-text); }
  .request-actions .done::after { content: 'Erledigt'; font-size: 11px; }
  @media (max-width: 620px) {
    .speech-queue, .speech-queue.below-banner { left: 6px; right: 6px; width: auto; }
    .request { grid-template-columns: 44px minmax(0, 1fr); }
    .request-actions button span { display: none; }
    .request-actions .done::after { content: ''; }
  }
</style>
