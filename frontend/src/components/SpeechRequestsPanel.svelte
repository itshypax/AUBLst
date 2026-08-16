<script lang="ts">
  import { onDestroy } from 'svelte';
  import FaIcon from './FaIcon.svelte';
  import { Check, Crosshair, FolderOpen, Hospital, RadioTower } from '../lib/fontawesome-icons';
  import { isHospitalTransportUnit } from '../lib/classify';
  import { acknowledgeLog, dismissLog } from '../lib/polling';
  import { buildSpeechRequestEntries, type SpeechRequestEntry } from '../lib/speech-requests';
  import { app, canWrite, focusVehicle, openAssign } from '../lib/state.svelte';

  let acknowledging = $state<Set<string>>(new Set());
  let dismissing = $state<Set<string>>(new Set());
  let menu = $state<{ key: string; x: number; y: number } | null>(null);
  let clickTimer: number | null = null;

  const entries = $derived(buildSpeechRequestEntries(app.logs, app.vehicles, app.events, app.assignments));
  const menuEntry = $derived(menu ? entries.find((entry) => entry.key === menu?.key) : undefined);

  $effect(() => {
    if (menu && !menuEntry) menu = null;
  });

  onDestroy(() => {
    if (clickTimer !== null) window.clearTimeout(clickTimer);
  });

  function vehicleName(entry: SpeechRequestEntry): string {
    return entry.vehicle?.name || entry.vehicle?.game_vehicle_id || entry.row.entity_id || 'Unbekannt';
  }

  function timeOf(entry: SpeechRequestEntry): string {
    return entry.requestedAt?.slice(11, 16) ?? '';
  }

  function isAcknowledged(entry: SpeechRequestEntry): boolean {
    return (
      acknowledging.has(entry.key) ||
      entry.rows.every((row) => row.acknowledged === true || Number(row.acknowledged) === 1)
    );
  }

  function openEvent(entry: SpeechRequestEntry): void {
    if (entry.event) openAssign(entry.event);
  }

  async function acknowledge(entry: SpeechRequestEntry): Promise<void> {
    if (isAcknowledged(entry) || acknowledging.has(entry.key) || !canWrite()) return;
    acknowledging = new Set(acknowledging).add(entry.key);
    try {
      await acknowledgeLog(entry.row.id);
    } catch (error) {
      app.lastError = (error as Error).message;
    } finally {
      const next = new Set(acknowledging);
      next.delete(entry.key);
      acknowledging = next;
    }
  }

  async function complete(entry: SpeechRequestEntry): Promise<void> {
    if (dismissing.has(entry.key) || !canWrite()) return;
    dismissing = new Set(dismissing).add(entry.key);
    try {
      await dismissLog(entry.row.id);
    } catch (error) {
      app.lastError = (error as Error).message;
    } finally {
      const next = new Set(dismissing);
      next.delete(entry.key);
      dismissing = next;
    }
  }

  function singleClick(entry: SpeechRequestEntry): void {
    if (clickTimer !== null) window.clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      openEvent(entry);
      void acknowledge(entry);
    }, 220);
  }

  function doubleClick(entry: SpeechRequestEntry): void {
    if (clickTimer !== null) window.clearTimeout(clickTimer);
    clickTimer = null;
    openEvent(entry);
    void complete(entry);
  }

  function onRowKeydown(event: KeyboardEvent, entry: SpeechRequestEntry): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openEvent(entry);
    void acknowledge(entry);
  }

  function openMenu(event: MouseEvent, entry: SpeechRequestEntry): void {
    event.preventDefault();
    menu = {
      key: entry.key,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 230)),
    };
  }

  function assignHospital(entry: SpeechRequestEntry): void {
    if (!entry.vehicle) return;
    app.hospitalAssignmentVehicleId = entry.vehicle.id;
    menu = null;
  }

  function centerVehicle(entry: SpeechRequestEntry): void {
    if (entry.vehicle) focusVehicle(entry.vehicle);
    menu = null;
  }

  function menuOpenEvent(entry: SpeechRequestEntry): void {
    openEvent(entry);
    void acknowledge(entry);
    menu = null;
  }

  function menuComplete(entry: SpeechRequestEntry): void {
    void complete(entry);
    menu = null;
  }
</script>

<section class="panel speech-panel">
  <div class="panel-header">
    <span class="icon"><FaIcon icon={RadioTower} size={14} /></span>
    <h2>Sprechwünsche</h2>
    <span class="count" aria-label={`${entries.length} offene Sprechwünsche`}>{entries.length}</span>
  </div>
  <div class="panel-body table-wrap">
    <table aria-label="Offene Sprechwünsche">
      <thead>
        <tr><th>Zeit</th><th>Fahrzeug</th></tr>
      </thead>
      <tbody>
        {#each entries as entry (entry.key)}
          <tr
            class:unacknowledged={!isAcknowledged(entry)}
            class:busy={dismissing.has(entry.key)}
            tabindex="0"
            onclick={() => singleClick(entry)}
            ondblclick={() => doubleClick(entry)}
            oncontextmenu={(event) => openMenu(event, entry)}
            onkeydown={(event) => onRowKeydown(event, entry)}
            aria-label={`${vehicleName(entry)}, ${entry.event?.name || 'ohne Einsatzbezug'}`}
          >
            <td class="time">{timeOf(entry)}</td>
            <td><span class="request-text">{vehicleName(entry)}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !entries.length}<div class="empty-hint">Keine offenen Sprechwünsche</div>{/if}
  </div>
</section>

{#if menu && menuEntry}
  <div
    class="menu-backdrop"
    role="presentation"
    onpointerdown={() => (menu = null)}
    oncontextmenu={(event) => {
      event.preventDefault();
      menu = null;
    }}
  ></div>
  <div
    class="request-menu"
    style={`left: ${menu.x}px; top: ${menu.y}px;`}
    role="menu"
    aria-label={`Aktionen für ${vehicleName(menuEntry)}`}
  >
    <div class="menu-head">
      <strong>{vehicleName(menuEntry)}</strong>
      <span>{menuEntry.event?.name || 'Ohne Einsatzbezug'}</span>
    </div>
    <button role="menuitem" disabled={!menuEntry.event} onclick={() => menuOpenEvent(menuEntry)}
      ><FaIcon icon={FolderOpen} size={14} /> Einsatz öffnen</button
    >
    {#if menuEntry.vehicle && isHospitalTransportUnit(menuEntry.vehicle)}
      <button role="menuitem" disabled={!canWrite()} onclick={() => assignHospital(menuEntry)}
        ><FaIcon icon={Hospital} size={14} /> Klinik zuweisen</button
      >
    {/if}
    {#if menuEntry.vehicle}
      <button role="menuitem" onclick={() => centerVehicle(menuEntry)}
        ><FaIcon icon={Crosshair} size={14} /> Auf Karte zentrieren</button
      >
    {/if}
    <button
      class="complete"
      role="menuitem"
      disabled={!canWrite() || dismissing.has(menuEntry.key)}
      onclick={() => menuComplete(menuEntry)}><FaIcon icon={Check} size={14} /> Sprechwunsch erledigen</button
    >
  </div>
{/if}

<style>
  .speech-panel {
    min-width: 0;
  }
  .count {
    margin-left: auto;
    min-width: 18px;
    color: var(--text-dim);
    font:
      11px ui-monospace,
      'Cascadia Mono',
      Consolas,
      monospace;
    text-align: right;
  }
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
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 500;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th:first-child {
    width: 52px;
  }
  .speech-panel tbody td {
    padding: 5px;
    border-bottom: 1px solid var(--border);
    color: #fff;
    font-size: 14px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  tbody tr {
    cursor: pointer;
    outline: none;
  }
  tbody tr:hover,
  tbody tr:focus-visible {
    background: var(--accent-soft);
  }
  tbody tr:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-outline);
  }
  tbody tr.busy {
    opacity: 0.55;
    pointer-events: none;
  }
  .speech-panel td.time {
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .request-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  tbody tr.unacknowledged {
    background-color: rgba(232, 82, 74, 0.72);
    animation: speech-request-alert 1.2s step-end infinite;
  }
  @keyframes speech-request-alert {
    0%, 49% {
      background-color: rgba(232, 82, 74, 0.72);
    }
    50%, 100% {
      background-color: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    tbody tr.unacknowledged {
      animation: none;
    }
  }
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
  }
  .request-menu {
    position: fixed;
    z-index: 71;
    width: 232px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .menu-head {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 5px 8px 7px;
    margin-bottom: 3px;
    border-bottom: 1px solid var(--border);
  }
  .menu-head strong,
  .menu-head span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu-head span {
    margin-top: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .request-menu button {
    width: 100%;
    justify-content: flex-start;
    padding: 6px 8px;
    border: 0;
    background: transparent;
  }
  .request-menu button:hover {
    background: var(--accent-soft);
  }
  .request-menu .complete {
    margin-top: 3px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    color: var(--good-text);
  }
</style>
