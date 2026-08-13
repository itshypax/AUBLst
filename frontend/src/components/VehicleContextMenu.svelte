<script lang="ts">
  import FaIcon from './FaIcon.svelte';
  import { Crosshair, Hospital, Route, Undo2 } from '../lib/fontawesome-icons';
  import { api } from '../lib/api';
  import { isHospitalTransportUnit } from '../lib/classify';
  import { focusTrap } from '../lib/focus';
  import { refreshState } from '../lib/polling';
  import { app, assignedEventForVehicle, canWrite, closeVehicleMenu, focusVehicle, showNotice } from '../lib/state.svelte';
  import StatusBadge from './StatusBadge.svelte';

  const menu = app.contextMenu!;
  const vehicle = $derived(app.vehicles.find((v) => v.id === menu.vehicleId));

  const isTransportUnit = $derived(Boolean(vehicle && isHospitalTransportUnit(vehicle)));
  const hospitalReservation = $derived(vehicle ? app.hospitalReservations.find((item) => item.vehicle_id === vehicle.id && item.status === 'reserved') : undefined);
  const canManageHospital = $derived(Boolean(vehicle && isTransportUnit && ([4, 5, 7].includes(Number(vehicle.status)) || hospitalReservation)));
  const currentEvent = $derived(vehicle ? assignedEventForVehicle(vehicle.id) : undefined);
  const reassignableEvents = $derived(app.events.filter((event) => event.status === 'active' && event.id !== currentEvent?.id));

  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: menu.x, y: menu.y });
  let choosingEvent = $state(false);
  let reassigning = $state(false);

  $effect(() => {
    if (!vehicle) {
      closeVehicleMenu();
      return;
    }
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pos = {
      x: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    };
  });

  function focus(): void {
    if (vehicle) focusVehicle(vehicle);
    closeVehicleMenu();
  }

  function assignHospital(): void {
    if (!vehicle) return;
    app.hospitalAssignmentVehicleId = vehicle.id;
    closeVehicleMenu();
  }

  async function sendHome(): Promise<void> {
    if (!vehicle) return;
    closeVehicleMenu();
    try {
      await api('events_unassign', { vehicle_ids: [vehicle.id] });
      await refreshState();
    } catch (err) {
      app.lastError = (err as Error).message;
    }
  }

  async function reassign(eventId: number): Promise<void> {
    if (!vehicle || reassigning) return;
    reassigning = true;
    try {
      await api('events_reassign', { vehicle_id: vehicle.id, event_id: eventId });
      const target = app.events.find((event) => event.id === eventId);
      showNotice(`${vehicle.name || vehicle.game_vehicle_id} ist jetzt ${target?.name || `Einsatz ${eventId}`} zugeordnet`);
      closeVehicleMenu();
      await refreshState();
    } catch (err) {
      app.lastError = (err as Error).message;
      reassigning = false;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      closeVehicleMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(el?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const direction = e.key === 'ArrowDown' ? 1 : -1;
    items[(current + direction + items.length) % items.length]?.focus();
  }
</script>

{#if vehicle}
  <div
    class="backdrop"
    onpointerdown={closeVehicleMenu}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeVehicleMenu();
    }}
    role="presentation"
  ></div>
  <div class="menu" bind:this={el} style="left: {pos.x}px; top: {pos.y}px;" role="menu" aria-label={`Aktionen für ${vehicle.name || vehicle.game_vehicle_id}`} onkeydown={onKeydown} use:focusTrap={{ initial: '[role="menuitem"]:not([disabled])', inertSiblings: false }} tabindex="-1">
    <div class="head">
      <StatusBadge value={vehicle.status} />
      <span class="vehicle-title">
        <span class="name">{vehicle.name || vehicle.type || vehicle.game_vehicle_id}</span>
        {#if currentEvent}<span class="assignment">{currentEvent.name || `Einsatz ${currentEvent.id}`}</span>{/if}
      </span>
    </div>
    <button class="item" role="menuitem" onclick={focus}>
      <FaIcon icon={Crosshair} size={14} />
      Auf Karte zentrieren
    </button>
    {#if canManageHospital}
      <button class="item" role="menuitem" disabled={!canWrite()} onclick={assignHospital}>
        <FaIcon icon={Hospital} size={14} />
        {hospitalReservation ? 'Klinikzuweisung ändern' : 'Klinik zuweisen'}
      </button>
    {/if}
    {#if Number(vehicle.status) >= 3 && Number(vehicle.status) <= 4}
      <button class="item" role="menuitem" aria-expanded={choosingEvent} disabled={!canWrite() || !reassignableEvents.length} onclick={() => (choosingEvent = !choosingEvent)}>
        <FaIcon icon={Route} size={14} />
        {currentEvent ? 'Anderem Einsatz zuordnen' : 'Einsatz zuordnen'}
      </button>
      {#if choosingEvent}
        <div class="event-list" aria-label="Zieleinsatz">
          {#each reassignableEvents as event (event.id)}
            <button class="event-item" role="menuitem" disabled={reassigning || !canWrite()} onclick={() => void reassign(event.id)}>
              <span>{event.name || 'Einsatz'}</span>
              <small>Nr. {event.id}</small>
            </button>
          {/each}
        </div>
      {/if}
      <button class="item" role="menuitem" disabled={!canWrite()} onclick={() => void sendHome()}>
        <FaIcon icon={Undo2} size={14} />
        Einrücken lassen
      </button>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 70;
  }

  .menu {
    position: fixed;
    z-index: 71;
    min-width: 210px;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .head .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vehicle-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .assignment {
    color: var(--text-dim);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item {
    background: transparent;
    border: none;
    justify-content: flex-start;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
  }

  .item:hover {
    background: var(--accent-soft);
  }

  .event-list {
    max-height: 190px;
    overflow: auto;
    margin: 0 4px 3px 22px;
    padding-left: 6px;
    border-left: 1px solid var(--border-strong);
  }

  .event-item {
    width: 100%;
    justify-content: space-between;
    border: 0;
    background: transparent;
    padding: 5px 6px;
    text-align: left;
  }

  .event-item span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-item small {
    color: var(--text-dim);
    flex: 0 0 auto;
  }

</style>
