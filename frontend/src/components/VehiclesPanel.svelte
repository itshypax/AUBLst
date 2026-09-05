<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Check, Hospital, Play, Plus, Search, TrafficCone, TriangleAlert, Undo2 } from '../lib/fontawesome-icons';
  import { api } from '../lib/api';
  import { actionUnits, hasLoeschzug, isHiddenUnit, isHospitalTransportUnit, loeschzugFor, stationColumns, stationGroups, tabLabel, vehicleDisplayName, vehicleTypeLabel, type MainTab, type StationGroup } from '../lib/classify';
  import { refreshState } from '../lib/polling';
  import { roadLocationLabel } from '../lib/routing';
  import { getSoundAlertConfig } from '../lib/sounds';
  import { app, canWrite, focusVehicle, openVehicleMenu, setDispatchVehicleIds, setHighlightedVehicle, toggleDispatchVehicle } from '../lib/state.svelte';
  import type { HospitalReservation, Vehicle } from '../lib/types';
  import { UnassignedVehicleWarningTracker } from '../lib/vehicle-warnings';
  import EmptyState from './EmptyState.svelte';
  import StatusBadge from './StatusBadge.svelte';

  let { pinnedTab = null }: { pinnedTab?: MainTab | null } = $props();

  let activeTab = $state<MainTab>('fire');
  // Fester Tab aus dem Layout hat Vorrang vor der Auswahl im Panel.
  const effectiveTab = $derived(pinnedTab ?? activeTab);
  let query = $state('');
  let searchInput: HTMLInputElement;
  let fireTab = $state<HTMLButtonElement>();
  let rescueTab = $state<HTMLButtonElement>();
  let returning = $state<Set<number>>(new Set());

  const filteredVehicles = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase('de');
    if (!term) return app.vehicles;
    return app.vehicles.filter((v) => `${v.name ?? ''} ${v.type ?? ''} ${v.game_vehicle_id}`.toLocaleLowerCase('de').includes(term));
  });
  const columns = $derived(stationColumns(filteredVehicles, effectiveTab));
  const actions = $derived(actionUnits(app.vehicles));
  const hasVehicles = $derived(columns.some((col) => col.length));
  const fireStations = $derived(new Map(stationGroups(app.vehicles, 'fire').map((group) => [group.key, group])));

  let nowMs = $state(Date.now());
  let warnIds = $state<Set<number>>(new Set());
  const unassignedVehicleWarnings = new UnassignedVehicleWarningTracker();

  $effect(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 5000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void nowMs;
    const assigned = new Set(app.assignments.map((a) => Number(a.vehicle_id)));
    const next = unassignedVehicleWarnings.update(app.vehicles, assigned, nowMs, getSoundAlertConfig()).activeIds;
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
    return vehicleDisplayName(v);
  }

  function canStage(v: Vehicle): boolean {
    return isHiddenUnit(v) || Number(v.status) === 1 || Number(v.status) === 2;
  }

  function zugFor(group: StationGroup): Vehicle[] {
    return loeschzugFor(group, canStage);
  }

  function stageZugalarm(groupKey: string): void {
    const group = fireStations.get(groupKey);
    if (!group) return;
    const additions = zugFor(group).map((vehicle) => vehicle.id);
    if (!additions.length) return;
    setDispatchVehicleIds([...new Set([...app.dispatchVehicleIds, ...additions])]);
  }

  function reservationFor(v: Vehicle) {
    return app.hospitalReservations.find((item) => item.vehicle_id === v.id
      && (item.status === 'reserved' || (item.status === 'arrived' && Number(v.status) === 8)));
  }

  function rowTitle(v: Vehicle, reservation?: HospitalReservation): string {
    const parts = [vehicleDisplayName(v)];
    const typeLabel = vehicleTypeLabel(v);
    if (typeLabel) parts.push(`Typ ${typeLabel}`);
    if (reservation) {
      const destination = (reservation.hospital_name || 'Klinik').replace(/^Krankenhaus\s+/i, '');
      parts.push(`Ziel: ${destination}${reservation.bed_type === 'icu' ? ' · Intensiv' : ''}`);
    }
    if (Number(v.unavailable_override ?? 0)) parts.push('Außer Dienst gesetzt vom Disponenten');
    const location = roadLocationLabel(v, app.routing);
    if (location) parts.push(location);
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
    (activeTab === 'fire' ? fireTab : rescueTab)?.focus();
  }
</script>

<section class="panel">
  <div class="panel-header">
    <h2>Fahrzeuge</h2>
    <span class="spacer"></span>
    <label class="vehicle-search">
      <FaIcon icon={Search} size={13} />
      <span class="sr-only">Fahrzeuge filtern</span>
      <input bind:this={searchInput} type="text" bind:value={query} placeholder="Filtern" />
      <kbd aria-label="Tastaturkürzel F">F</kbd>
    </label>
    {#if pinnedTab}
      <span class="pinned-tab">{tabLabel[pinnedTab]} <span class="count">{counts[pinnedTab]}</span></span>
    {:else}
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
    {/if}
    {#if actions.length}
      <button class="actions-btn" data-tooltip="Sperrungen und Freigaben auslösen" onclick={() => (app.actionsOpen = true)}>
        <FaIcon icon={TrafficCone} size={14} />
        Aktionen
      </button>
    {/if}
  </div>

  <div class="panel-body" id="vehicle-list" role="tabpanel" aria-label={tabLabel[effectiveTab]}>
    <div class="columns">
      {#each columns as column, i (i)}
        <div class="column">
          {#each column as g (g.key)}
            {@const zugGroup = fireStations.get(g.key)}
            <div class="group">
              <div class="group-header" class:fire={effectiveTab === 'fire'} class:rescue={effectiveTab === 'rescue'}>
                <span>{g.label}</span>
                {#if app.assignEvent?.status === 'active' && activeTab === 'fire' && ['1', '2', '3', '4'].includes(g.key) && zugGroup && hasLoeschzug(zugGroup)}
                  <button
                    class="zug-alarm"
                    disabled={!zugFor(zugGroup).length}
                    data-tooltip={`${g.label}: Zugfahrzeuge vormerken`}
                    aria-label={`Zugalarm ${g.label} für Einsatz ${app.assignEvent.id} vormerken`}
                    onclick={() => stageZugalarm(g.key)}
                  >
                    <FaIcon icon={Play} size={11} />
                    Zugalarm
                  </button>
                {/if}
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
                        <span class="warn" data-tooltip="Nicht eingerückt" aria-label="Nicht eingerückt"><FaIcon icon={TriangleAlert} size={13} /></span>
                      {/if}
                    </button>
                    {#if isHospitalTransportUnit(v) && ([4, 5, 7].includes(Number(v.status)) || reservation)}
                      <button class="ghost row-action hospital-action" class:intensive={reservation?.bed_type === 'icu'} data-tooltip={reservation ? 'Klinikzuweisung ändern' : 'Klinik zuweisen'} aria-label={`${displayName(v)} ${reservation ? 'Klinikzuweisung ändern' : 'eine Klinik zuweisen'}`} disabled={!canWrite()} onclick={(e) => { e.stopPropagation(); app.hospitalAssignmentVehicleId = v.id; }}>
                        <FaIcon icon={Hospital} size={14} />
                      </button>
                    {/if}
                    {#if Number(v.status) === 3}
                      <button class="ghost row-action" data-tooltip="Einrücken lassen" aria-label={`${displayName(v)} einrücken lassen`} disabled={returning.has(v.id) || !canWrite()} onclick={(e) => { e.stopPropagation(); void sendHome(v); }}>
                        <FaIcon icon={Undo2} size={14} />
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
                        {#if app.dispatchVehicleIds.includes(v.id)}<FaIcon icon={Check} size={15} />{:else}<FaIcon icon={Plus} size={15} />{/if}
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
  .pinned-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }

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

  .zug-alarm {
    gap: 4px;
    padding: 1px 5px;
    border-color: transparent;
    background: transparent;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }

  .zug-alarm:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-raised);
    color: var(--text);
  }

  .group-header.fire {
    border-left: 3px solid var(--danger);
  }

  .group-header.rescue {
    border-left: 3px solid var(--warn);
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
    border-color: var(--attention-border);
    background: var(--attention-bg);
    color: var(--attention-text);
  }

  .actions-btn:hover:not(:disabled) {
    background: var(--attention-bg-hover);
    border-color: var(--attention-border);
    color: var(--attention-text);
  }

  @media (max-width: 700px) {
    .vehicle-search { order: 4; width: 100%; }
    .vehicle-search input { flex: 1; }
    .panel-header { flex-wrap: wrap; }
    .tabs { margin-left: auto; }
  }
</style>
