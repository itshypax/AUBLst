<script lang="ts">
  import { Crosshair, Hospital, Undo2 } from 'lucide-svelte';
  import { api } from '../lib/api';
  import { isHospitalTransportUnit } from '../lib/classify';
  import { focusTrap } from '../lib/focus';
  import { refreshState } from '../lib/polling';
  import { app, canWrite, closeVehicleMenu, focusVehicle } from '../lib/state.svelte';
  import StatusBadge from './StatusBadge.svelte';

  const menu = app.contextMenu!;
  const vehicle = $derived(app.vehicles.find((v) => v.id === menu.vehicleId));

  const isTransportUnit = $derived(Boolean(vehicle && isHospitalTransportUnit(vehicle)));
  const hospitalReservation = $derived(vehicle ? app.hospitalReservations.find((item) => item.vehicle_id === vehicle.id && item.status === 'reserved') : undefined);
  const canManageHospital = $derived(Boolean(vehicle && isTransportUnit && ([4, 5, 7].includes(Number(vehicle.status)) || hospitalReservation)));

  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ x: menu.x, y: menu.y });

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
      <span class="name">{vehicle.name || vehicle.type || vehicle.game_vehicle_id}</span>
    </div>
    <button class="item" role="menuitem" onclick={focus}>
      <Crosshair size={14} />
      Auf Karte zentrieren
    </button>
    {#if canManageHospital}
      <button class="item" role="menuitem" disabled={!canWrite()} onclick={assignHospital}>
        <Hospital size={14} />
        {hospitalReservation ? 'Klinikzuweisung ändern' : 'Klinik zuweisen'}
      </button>
    {/if}
    {#if Number(vehicle.status) >= 3 && Number(vehicle.status) <= 4}
      <button class="item" role="menuitem" disabled={!canWrite()} onclick={() => void sendHome()}>
        <Undo2 size={14} />
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

</style>
