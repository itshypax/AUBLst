<script lang="ts">
  import { Check, Hospital, Plus, Search, TrafficCone, TriangleAlert, Truck, Undo2 } from 'lucide-svelte';
  import { api } from '../lib/api';
  import { actionUnits, isHiddenUnit, isHospitalTransportUnit, stationColumns, stationGroups, tabLabel, vehicleTypeLabel, type MainTab } from '../lib/classify';
  import { refreshState } from '../lib/polling';
  import { app, canWrite, focusVehicle, openVehicleMenu, setHighlightedVehicle, toggleDispatchVehicle } from '../lib/state.svelte';
  import type { HospitalReservation, Vehicle } from '../lib/types';
  import EmptyState from './EmptyState.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let activeTab = $state<MainTab>('fire');
  let query = $state('');
  let searchInput: HTMLInputElement;
  let handledSearchFocus = 0;
  let fireTab: HTMLButtonElement;
  let rescueTab: HTMLButtonElement;
  let returning = $state<Set<number>>(new Set());

  $effect(() => {
    const sequence = app.focusVehicleSearchSeq;
    if (!sequence || sequence === handledSearchFocus) return;
    handledSearchFocus = sequence;
    requestAnimationFrame(() => {
      searchInput?.focus();
      searchInput?.select();
    });
  });

  const filteredVehicles = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase('de');
    if (!term) return app.vehicles;
    return app.vehicles.filter((v) => `${v.name ?? ''} ${v.type ?? ''} ${v.game_vehicle_id}`.toLocaleLowerCase('de').includes(term));
  });
  const columns = $derived(stationColumns(filteredVehicles, activeTab));
  const actions = $derived(actionUnits(app.vehicles));
  const hasVehicles = $derived(columns.some((col) => col.length));

  // Status 4 ohne Einsatzzuordnung länger als 90 s = nicht eingerückt
  const NOT_RETURNED_MS = 90_000;
  let nowMs = $state(Date.now());
  let warnIds = $state<Set<number>>(new Set());
  const status4Since = new Map<number, number>();

  $effect(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 5000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void nowMs;
    const assigned = new Set(app.assignments.map((a) => Number(a.vehicle_id)));
    const now = Date.now();
    const next = new Set<number>();
    for (const v of app.vehicles) {
      const lingering = Number(v.status) === 4 && !assigned.has(v.id);
      if (!lingering) {
        status4Since.delete(v.id);
        continue;
      }
      if (!status4Since.has(v.id)) {
        status4Since.set(v.id, now);
      }
      if (now - status4Since.get(v.id)! >= NOT_RETURNED_MS) {
        next.add(v.id);
      }
    }
    if (next.size !== warnIds.size || [...next].some((id) => !warnIds.has(id))) {
      warnIds = next;
    }
  });

  const counts = $derived.by(() => {
    const c = { fire: 0, rescue: 0 };
    for (const g of stationGroups(app.vehicles, 'fire')) c.fire += g.vehicles.length;
    for (const g of stationGroups(app.vehicles, 'rescue')) c.rescue += g.vehicles.length;
    return c;
  });

  function displayName(v: Vehicle): string {
    return v.name || v.type || v.game_vehicle_id;
  }

  function canStage(v: Vehicle): boolean {
    return isHiddenUnit(v) || Number(v.status) === 1 || Number(v.status) === 2;
  }

  function reservationFor(v: Vehicle) {
    return app.hospitalReservations.find((item) => item.vehicle_id === v.id
      && (item.status === 'reserved' || (item.status === 'arrived' && Number(v.status) === 8)));
  }

  function rowTitle(v: Vehicle, reservation?: HospitalReservation): string {
    const parts = [v.name || v.game_vehicle_id];
    const typeLabel = vehicleTypeLabel(v);
    if (typeLabel) parts.push(`Typ ${typeLabel}`);
    parts.push(v.game_vehicle_id);
    if (reservation) {
      const destination = (reservation.hospital_name || 'Klinik').replace(/^Krankenhaus\s+/i, '');
      parts.push(`Ziel: ${destination}${reservation.bed_type === 'icu' ? ' · Intensiv' : ''}`);
    }
    return parts.join(' · ');
  }

  async function sendHome(v: Vehicle): Promise<void> {
    if (returning.has(v.id)) return;
    returning = new Set(returning).add(v.id);
    try {
      await api('events_unassign', { vehicle_ids: [v.id] });
      await refreshState();
    } catch (err) {
      app.lastError = (err as Error).message;
    } finally {
      const next = new Set(returning);
      next.delete(v.id);
      returning = next;
    }
  }

  function openMenuForElement(v: Vehicle, element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    openVehicleMenu(v.id, rect.right - 8, rect.top + 8);
  }

  function onRowKey(e: KeyboardEvent, v: Vehicle): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusVehicle(v);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      openMenuForElement(v, e.currentTarget as HTMLElement);
    }
  }

  function onTabKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    activeTab = activeTab === 'fire' ? 'rescue' : 'fire';
    (activeTab === 'fire' ? fireTab : rescueTab).focus();
  }
</script>

<section class="panel">
  <div class="panel-header">
    <span class="icon"><Truck size={14} /></span>
    <h2>Fahrzeuge</h2>
    <span class="spacer"></span>
    <label class="vehicle-search">
      <Search size={13} />
      <span class="sr-only">Fahrzeuge filtern</span>
      <input bind:this={searchInput} type="text" bind:value={query} placeholder="Filtern" />
      <kbd aria-label="Tastaturkürzel F">F</kbd>
    </label>
    <div class="tabs" role="tablist">
      <button
        bind:this={fireTab}
        class="tab"
        class:active={activeTab === 'fire'}
        role="tab"
        aria-selected={activeTab === 'fire'}
        aria-controls="vehicle-list"
        tabindex={activeTab === 'fire' ? 0 : -1}
        onkeydown={onTabKey}
        onclick={() => (activeTab = 'fire')}
      >
        {tabLabel.fire}
        <span class="count">{counts.fire}</span>
      </button>
      <button
        bind:this={rescueTab}
        class="tab"
        class:active={activeTab === 'rescue'}
        role="tab"
        aria-selected={activeTab === 'rescue'}
        aria-controls="vehicle-list"
        tabindex={activeTab === 'rescue' ? 0 : -1}
        onkeydown={onTabKey}
        onclick={() => (activeTab = 'rescue')}
      >
        {tabLabel.rescue}
        <span class="count">{counts.rescue}</span>
      </button>
    </div>
    {#if actions.length}
      <button class="actions-btn" data-tooltip="Sperrungen und Freigaben auslösen" onclick={() => (app.actionsOpen = true)}>
        <TrafficCone size={14} />
        Aktionen
      </button>
    {/if}
  </div>

  <div class="panel-body" id="vehicle-list" role="tabpanel" aria-label={tabLabel[activeTab]}>
    <div class="columns">
      {#each columns as column, i (i)}
        <div class="column">
          {#each column as g (g.key)}
            <div class="group">
              <div class="group-header" class:fire={activeTab === 'fire'} class:rescue={activeTab === 'rescue'}>
                <span>{g.label}</span>
                <span class="count">{g.vehicles.length}</span>
              </div>
              <div class="vehicle-list" role="list">
                {#each g.vehicles as v (v.id)}
                  {@const reservation = reservationFor(v)}
                  <div
                    class="row"
                    class:highlighted={app.highlightedVehicleId === v.id}
                    class:staged={app.dispatchVehicleIds.includes(v.id)}
                    role="listitem"
                  >
                    <button
                      class="vehicle-main"
                      onmouseenter={() => setHighlightedVehicle(v.id)}
                      onmouseleave={() => setHighlightedVehicle(null)}
                      onfocus={() => setHighlightedVehicle(v.id)}
                      oncontextmenu={(e) => {
                        e.preventDefault();
                        openVehicleMenu(v.id, e.clientX, e.clientY);
                      }}
                      onkeydown={(e) => onRowKey(e, v)}
                      onclick={() => focusVehicle(v)}
                      aria-label={`${displayName(v)}, Status ${v.status}, auf Karte zeigen`}
                    >
                      <StatusBadge value={v.status} />
                      <span class="vehicle-label" data-tooltip={rowTitle(v, reservation)}>
                        <span class="name">{displayName(v)}</span>
                        {#if reservation}
                          <span class="destination" class:intensive={reservation.bed_type === 'icu'}>→ {reservation.hospital_name || 'Klinik'}{reservation.bed_type === 'icu' ? ' · Intensiv' : ''}</span>
                        {/if}
                      </span>
                      {#if warnIds.has(v.id)}
                        <span class="warn" data-tooltip="Nicht eingerückt" aria-label="Nicht eingerückt"><TriangleAlert size={13} /></span>
                      {/if}
                    </button>
                    {#if isHospitalTransportUnit(v) && ([4, 5, 7].includes(Number(v.status)) || reservation)}
                      <button class="ghost row-action hospital-action" class:intensive={reservation?.bed_type === 'icu'} data-tooltip={reservation ? 'Klinikzuweisung ändern' : 'Klinik zuweisen'} aria-label={`${displayName(v)} ${reservation ? 'Klinikzuweisung ändern' : 'eine Klinik zuweisen'}`} disabled={!canWrite()} onclick={(e) => { e.stopPropagation(); app.hospitalAssignmentVehicleId = v.id; }}>
                        <Hospital size={14} />
                      </button>
                    {/if}
                    {#if Number(v.status) === 3}
                      <button class="ghost row-action" data-tooltip="Einrücken lassen" aria-label={`${displayName(v)} einrücken lassen`} disabled={returning.has(v.id) || !canWrite()} onclick={(e) => { e.stopPropagation(); void sendHome(v); }}>
                        <Undo2 size={14} />
                      </button>
                    {/if}
                    {#if app.assignEvent && (canStage(v) || app.dispatchVehicleIds.includes(v.id))}
                      <button
                        class="ghost row-action dispatch-action"
                        class:selected={app.dispatchVehicleIds.includes(v.id)}
                        data-tooltip={app.dispatchVehicleIds.includes(v.id) ? 'Vormerkung entfernen' : `Für Einsatz ${app.assignEvent.id} vormerken`}
                        aria-label={`${displayName(v)} ${app.dispatchVehicleIds.includes(v.id) ? 'aus der Vormerkung entfernen' : `für Einsatz ${app.assignEvent.id} vormerken`}`}
                        onclick={(e) => { e.stopPropagation(); toggleDispatchVehicle(v.id); }}
                      >
                        {#if app.dispatchVehicleIds.includes(v.id)}<Check size={15} />{:else}<Plus size={15} />{/if}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </div>
    {#if !hasVehicles}
      <EmptyState compact search={Boolean(query.trim())} title={query.trim() ? 'Keine passenden Fahrzeuge' : 'Keine Fahrzeuge gemeldet'} description={query.trim() ? 'Suchbegriff ändern oder anderen Bereich wählen.' : 'Gemeldete Fahrzeuge erscheinen automatisch in ihrer Wache.'} />
    {/if}
  </div>

</section>

<style>
  .tabs {
    display: flex;
    gap: 4px;
  }

  .vehicle-search { display: flex; align-items: center; gap: 5px; color: var(--text-dim); }
  .vehicle-search input { width: 108px; padding: 4px 7px; font-size: 12px; }
  .vehicle-search kbd { min-width: 20px; padding: 1px 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-dim); font: 10px ui-monospace, 'Cascadia Mono', Consolas, monospace; text-align: center; }

  .tab {
    padding: 4px 10px;
    font-size: 12px;
    border-radius: var(--radius-sm);
    background: transparent;
    border-color: transparent;
    color: var(--text-dim);
  }

  .tab.active {
    background: var(--accent-soft);
    border-color: var(--selection);
    color: var(--text);
  }

  .count {
    font-size: 11px;
    color: var(--text-dim);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 6px;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    align-items: start;
  }

  .column {
    min-width: 0;
  }

  .group {
    margin-bottom: 10px;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
    background: var(--panel-header);
    border: 1px solid var(--border);
    margin-bottom: 5px;
    position: sticky;
    top: -8px;
    z-index: 1;
  }

  .group-header .count {
    margin-left: auto;
  }

  .group-header.fire {
    border-left: 3px solid var(--danger);
  }

  .group-header.rescue {
    border-left: 3px solid var(--good);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 3px;
    padding: 3px 4px;
    font-size: 13px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
  }

  .vehicle-main { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; text-align: left; }
  .vehicle-main:hover:not(:disabled) { background: transparent; border-color: transparent; }
  .vehicle-main :global(.status-badge) { justify-self: start; }
  .vehicle-main .name { min-width: 0; }
  .vehicle-label { min-width: 0; display: flex; flex-direction: column; line-height: 1.15; }
  .destination { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); font-size: 10px; }
  .destination.intensive { color: var(--danger-text); }

  .row:hover,
  .row.highlighted,
  .row.staged {
    background: var(--accent-soft);
    border-color: var(--selection);
  }

  .row.staged { border-left: 2px solid var(--warn); }

  .row .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-action { justify-self: end; }
  .row-action { opacity: 0.25; }
  .row:hover .row-action, .row:focus-within .row-action { opacity: 1; }
  .dispatch-action,
  .dispatch-action.selected { color: var(--text-dim); opacity: .72; }
  .dispatch-action:hover,
  .dispatch-action.selected:hover { color: var(--text); opacity: 1; }
  .hospital-action { color: var(--accent); }
  .hospital-action.intensive { color: var(--danger-text); }

  .row .warn {
    color: var(--warn);
    display: inline-flex;
    flex: 0 0 auto;
    animation: warn-pulse 1.6s ease-in-out infinite;
  }

  @keyframes warn-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .actions-btn {
    margin-left: 8px;
    font-size: 12px;
    border-radius: var(--radius-sm);
    border-color: var(--status-3-border);
    background: rgba(240, 160, 60, 0.1);
    color: #ffd9a8;
  }

  .actions-btn:hover:not(:disabled) {
    background: rgba(240, 160, 60, 0.22);
    border-color: var(--status-3-start);
  }

  @media (max-width: 700px) {
    .vehicle-search { order: 4; width: 100%; }
    .vehicle-search input { flex: 1; }
    .panel-header { flex-wrap: wrap; }
    .tabs { margin-left: auto; }
  }
</style>
